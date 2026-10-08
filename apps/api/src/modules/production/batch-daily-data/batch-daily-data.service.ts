import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Inject,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, inArray, or, sql, isNull, gt, like, desc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { CreateBatchDailyDataDto } from './dto/batch-daily-data.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { BatchService, type UserContext } from '../batch/batch.service';
import { BatchTransferService } from '../batch/batch-transfer.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { AnimalMovementLogService } from '../../piggery/animal-movement-log/animal-movement-log.service';
import { SiloFeedService } from '../../inventory/silo-feed/silo-feed.service';
import { FeedAlertService } from '../../inventory/feed-alert/feed-alert.service';
import { withTenantTransaction } from '../../../common/tenant-transaction';
import { allocateAcrossLots, orderLots, parseLotList } from './lot-allocation';
import { allocateSharesToParts } from './consumption-split';
import { lotBalances } from '../../inventory/inventory-ledger/lot-balance';

const round = (n: number) => Math.round(n * 1e4) / 1e4;

const toMysqlTimestamp = (date: Date = new Date()) =>
  date.toISOString().slice(0, 19).replace('T', ' ');

/**
 * A consumption entry that has passed every check and is waiting to be issued. A day post collects them
 * so each activity's animals are issued together, as one ledger entry (see postCollected).
 */
export interface PendingConsumption {
  entryId: string;
  batchId: string;
  tenantId: string;
  userPayload?: UserContext;
  dto: CreateBatchDailyDataDto;
  line: typeof schema.schedulerLine.$inferSelect;
  header: typeof schema.schedulerHeader.$inferSelect;
  farmId: string | null;
  item: typeof schema.itemMaster.$inferSelect | undefined;
  resolvedItemId: string;
  sourceWarehouseId: string | undefined;
  deferFeedAlerts: boolean;
}

/**
 * Turns one scheduler_line checklist answer into whatever the "LINE TYPE
 * REFERENCE" sheet (Master Templates/Schedule_master_template.xlsx) says that
 * line_type does on posting — reusing the batch module's existing, already-
 * correct costing/GL pipeline (BatchService.addTransaction) rather than
 * re-deriving FIFO/standard-cost/bio-asset logic here.
 */
@Injectable()
export class BatchDailyDataService {
  constructor(
    private readonly cls: ClsService,
    private readonly auditService: AuditLogService,
    // The provider graph is circular even though the compiled JS import
    // isn't (BatchService only holds a `import type` + string-token
    // reference to this class — see batch.service.ts): Nest still has to
    // build BatchService's 'BATCH_DAILY_DATA_POSTER' dependency (== this
    // class) and this class's own BatchService dependency in the same
    // breath, and silently hangs at boot instead of erroring without
    // forwardRef on at least one side of that instantiation cycle.
    @Inject(forwardRef(() => BatchService))
    private readonly batchService: BatchService,
    private readonly batchTransferService: BatchTransferService,
    private readonly glPostingService: GlPostingService,
    private readonly movementLog: AnimalMovementLogService,
    private readonly siloFeedService: SiloFeedService,
    // POST Day consumption lowers the silo it drew from (Plan A Task 4), so
    // the farm's silo levels are re-checked afterwards (checkpoint 12).
    // Optional so a testing module that does not provide it still builds.
    @Optional() private readonly feedAlerts?: FeedAlertService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb)
      throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  async postEntry(
    batchId: string,
    dto: CreateBatchDailyDataDto,
    tenantId: string,
    userPayload?: UserContext,
    // BatchService.postBatchDay/postStageDay post a whole day's drafts through
    // here one line at a time; they pass this and re-check the silo levels
    // once for the day (Ruling M6), not once per line.
    opts: { deferFeedAlerts?: boolean; collector?: PendingConsumption[] } = {},
  ) {
    // Throws (404/403) if the batch doesn't exist or isn't in the caller's
    // farm/company/lob scope — BatchService.findOne is the shared, audited
    // scope check every batch surface goes through.
    await this.batchService.findOne(batchId);

    const [line] = await this.db
      .select()
      .from(schema.schedulerLine)
      .where(eq(schema.schedulerLine.line_id, dto.line_id))
      .limit(1);
    if (!line)
      throw new NotFoundException(`Scheduler line '${dto.line_id}' not found.`);
    if (!line.is_active)
      throw new ConflictException(
        'This line has been deactivated and no longer accepts entries.',
      );

    const [header] = await this.db
      .select()
      .from(schema.schedulerHeader)
      .where(eq(schema.schedulerHeader.scheduler_id, line.scheduler_id))
      .limit(1);
    if (!header || header.batch_id !== batchId) {
      throw new BadRequestException(
        `Line '${dto.line_id}' does not belong to batch '${batchId}'.`,
      );
    }
    if (line.lot_required && !dto.lot_no && !dto.serial_no) {
      // Only an item tracked by lot or serial has one to name: lines generated before this rule was
      // applied can carry lot_required on an untracked item, which is priced by its costing method alone.
      const [tracked] = line.item_id
        ? await this.db
            .select({ lot: schema.itemMaster.is_lot_tracked, serial: schema.itemMaster.is_serial_tracked })
            .from(schema.itemMaster)
            .where(eq(schema.itemMaster.item_id, line.item_id))
            .limit(1)
        : [];
      if (!line.item_id || tracked?.lot || tracked?.serial) {
        throw new BadRequestException(
          `'${line.activity_name}' requires a lot or serial number.`,
        );
      }
    }

    // ANIMAL_WISE batches have no single current stage — this scheduler_header
    // belongs to exactly one of the batch's several concurrently-active stages,
    // so an entry against it must be attributed to a specific animal, and that
    // animal must actually be at THIS line's stage right now (not merely
    // somewhere in the batch) — otherwise a stage's headcount/mortality math
    // would silently include an animal whose own schedule doesn't cover it.
    const [batchRow] = await this.db
      .select({
        tracking_mode: schema.batchHeader.tracking_mode,
        company_id: schema.batchHeader.company_id,
        shed_id: schema.batchHeader.shed_id,
        location_id: schema.batchHeader.location_id,
        batch_no: schema.batchHeader.batch_no,
        // The last resort when resolving where a consumption line draws its
        // stock from: a batch whose scheduler records no shed or pen still
        // belongs to a farm, and that farm's store is the right source.
        farm_id: schema.batchHeader.farm_id,
      })
      .from(schema.batchHeader)
      .where(eq(schema.batchHeader.batch_id, batchId))
      .limit(1);
    if (batchRow?.tracking_mode === 'ANIMAL_WISE' && !dto.animal_id) {
      throw new BadRequestException(
        `Batch '${batchId}' is Animal Wise — choose an animal for data entry.`,
      );
    }
    if (dto.animal_id) {
      const [animal] = await this.db
        .select()
        .from(schema.animalRegister)
        .where(eq(schema.animalRegister.animal_id, dto.animal_id))
        .limit(1);
      if (!animal)
        throw new NotFoundException(`Animal '${dto.animal_id}' not found.`);
      if (animal.current_batch_id !== batchId) {
        throw new BadRequestException(
          `Animal '${animal.animal_code}' is not currently in batch '${batchId}'.`,
        );
      }
      if (animal.current_stage_id !== header.stage_id) {
        throw new BadRequestException(
          `Animal '${animal.animal_code}' is not currently at this line's stage — its own schedule doesn't include this activity.`,
        );
      }
    }

    // ANIMAL_WISE only (see batch_data_entry_lock's own comment in schema.ts —
    // Batch-wise has no day-lock in this pass). Once "POST STAGE DATA" has
    // locked this stage+date, every write against it is refused outright —
    // this is also what actually closes the double-posting hole: re-saving an
    // already-posted entry used to silently re-run the full ledger/GL/transfer
    // dispatch a second time; once locked, that can no longer happen at all.
    if (header.stage_id) {
      const [lock] = await this.db
        .select({ status: schema.batchDataEntryLock.status })
        .from(schema.batchDataEntryLock)
        .where(
          and(
            eq(schema.batchDataEntryLock.batch_id, batchId),
            eq(schema.batchDataEntryLock.stage_id, header.stage_id),
            eq(schema.batchDataEntryLock.entry_date, dto.entry_date),
          ),
        )
        .limit(1);
      if (lock?.status === 'LOCKED') {
        throw new ConflictException(
          `This stage's data for ${dto.entry_date} has been posted and locked. Request a reopen to correct it.`,
        );
      }
    }

    // Idempotency guard — CONSUMPTION/OUTPUT/OVERHEAD/RESOURCE/TRANSFER all
    // dispatch a real side effect below (a new inventory_ledger/transaction
    // row, an animal transfer, ...) that batch_daily_data's own upsert alone
    // does not undo on a re-save. Without this, re-submitting an already-
    // posted line with the exact same value — the frontend's "Post Entry"
    // button saves a draft and then posts in the same click, so any line the
    // user already saved gets resubmitted verbatim — silently doubled the
    // ledger/GL/transfer dispatch every time, even though batch_daily_data
    // itself correctly showed only one row. A genuinely changed value still
    // falls through and posts normally, same as before.
    const existingRowWhere = dto.animal_id
      ? and(
          eq(schema.batchDailyData.line_id, dto.line_id),
          eq(schema.batchDailyData.entry_date, dto.entry_date),
          eq(schema.batchDailyData.animal_id, dto.animal_id),
        )
      : and(
          eq(schema.batchDailyData.line_id, dto.line_id),
          eq(schema.batchDailyData.entry_date, dto.entry_date),
          isNull(schema.batchDailyData.animal_id),
        );
    const [existingRow] = await this.db
      .select()
      .from(schema.batchDailyData)
      .where(existingRowWhere)
      .limit(1);
    if (existingRow?.posted) {
      const existingValue =
        existingRow.entered_value == null
          ? null
          : Number(existingRow.entered_value);
      const incomingValue =
        dto.entered_value == null ? null : dto.entered_value;
      const unchanged =
        existingValue === incomingValue &&
        (existingRow.entered_text || null) === (dto.entered_text || null) &&
        (existingRow.lot_no || null) === (dto.lot_no || null) &&
        (existingRow.serial_no || null) === (dto.serial_no || null);
      if (unchanged) {
        return this.findForDate(batchId, dto.entry_date, tenantId);
      }
    }

    // Draft save — records the value for later without touching inventory,
    // GL, animal_count, or a transfer. Nothing here dispatches until this
    // exact (line_id, entry_date[, animal_id]) is resubmitted with `draft`
    // omitted — see BatchService.postBatchDay(), which does that for every
    // draft row of the day once "Post Entry" is clicked. Skipped once the
    // row is already posted for real (nothing left to draft-save over it).
    if (dto.draft && !existingRow?.posted) {
      await this.db
        .insert(schema.batchDailyData)
        .values({
          entry_id: randomUUID(),
          tenant_id: tenantId,
          company_id: header.company_id,
          line_id: line.line_id,
          batch_id: batchId,
          animal_id: dto.animal_id || null,
          entry_date: dto.entry_date,
          entered_value: dto.entered_value?.toString() ?? null,
          entered_text: dto.entered_text || null,
          lot_no: dto.lot_no || null,
          serial_no: dto.serial_no || null,
          posted: false,
          posting_reference: null,
          alert_triggered: false,
          alert_note: null,
          remarks: dto.remarks || null,
          created_by: userPayload?.userId || null,
          updated_by: userPayload?.userId || null,
        })
        .onDuplicateKeyUpdate({
          set: {
            entered_value: dto.entered_value?.toString() ?? null,
            entered_text: dto.entered_text || null,
            lot_no: dto.lot_no || null,
            serial_no: dto.serial_no || null,
            remarks: dto.remarks || null,
            updated_by: userPayload?.userId || null,
            updated_at: toMysqlTimestamp(),
          },
        });
      return this.findForDate(batchId, dto.entry_date, tenantId);
    }

    const entryId = randomUUID();
    let posted = false;
    let postingReference: string | null = null;
    let alertTriggered = false;
    let alertNote: string | null = null;
    // What the daily row records as remarks: the user's text, plus the lot split of a multi-lot entry.
    let dailyRemarks: string | null | undefined = dto.remarks;

    switch (line.line_type) {
      case 'CONSUMPTION':
      case 'OUTPUT': {
        let resolvedItemId = line.item_id;
        if (!resolvedItemId && line.line_type === 'OUTPUT') {
          const [matched] = await this.db
            .select({ item_id: schema.itemMaster.item_id })
            .from(schema.itemMaster)
            .where(
              and(
                eq(schema.itemMaster.tenant_id, tenantId),
                eq(schema.itemMaster.is_active, true),
                or(
                  like(schema.itemMaster.item_name, '%Piglet%'),
                  eq(schema.itemMaster.item_type, 'LIVESTOCK'),
                ),
              ),
            )
            .orderBy(desc(schema.itemMaster.item_type))
            .limit(1);
          resolvedItemId = matched?.item_id || null;
        }
        if (!resolvedItemId)
          throw new ConflictException(
            `'${line.activity_name}' has no item configured — fix the line before posting entries against it.`,
          );
        if (dto.entered_value == null)
          throw new BadRequestException(
            'Enter a value for this line.',
          );
        const [item] = await this.db
          .select()
          .from(schema.itemMaster)
          .where(eq(schema.itemMaster.item_id, resolvedItemId))
          .limit(1);
        // Feed and medicine come out of somewhere physical: the silo standing
        // at this batch's shed, or the farm store behind it. Only CONSUMPTION
        // draws stock down — an OUTPUT line puts stock IN and has no source to
        // resolve, so it is left exactly as it was.
        let sourceWarehouseId: string | undefined;
        if (line.line_type === 'CONSUMPTION') {
          // Serial numbers are issued from wherever they are: applyFifo finds the location that holds them
          // and overrides this one, so the location resolved here is only the default.
          if (!sourceWarehouseId) {
            sourceWarehouseId = await this.resolveConsumptionWarehouse(
              header.location_id,
              resolvedItemId,
              line.activity_name,
              batchRow?.farm_id ?? null,
              header.company_id,
              tenantId,
            );
          }
        }
        if (line.line_type === 'CONSUMPTION') {
          const pending: PendingConsumption = {
            entryId,
            batchId,
            tenantId,
            userPayload,
            dto,
            line,
            header,
            farmId: batchRow?.farm_id ?? null,
            item,
            resolvedItemId,
            sourceWarehouseId,
            deferFeedAlerts: !!opts.deferFeedAlerts,
          };
          // A day post hands in a collector: the activity's animals are issued together afterwards, as one ledger entry.
          if (opts.collector) {
            opts.collector.push(pending);
            return this.findForDate(batchId, dto.entry_date, tenantId);
          }
          await this.postConsumptionGroup([pending]);
          return this.findForDate(batchId, dto.entry_date, tenantId);
        }

        // OUTPUT: stock comes in, there is nothing to draw — one entry, as it always was.
        const updated = await this.batchService.addTransaction(
          batchId,
          {
            transaction_date: dto.entry_date,
            transaction_type: line.line_type,
            item_id: resolvedItemId,
            quantity: dto.entered_value,
            uom: item?.uom_primary || 'PCS',
            rate: dto.rate,
            animal_id: dto.animal_id,
            lot_no: dto.lot_no,
            serial_no: dto.serial_no,
            remarks: dto.remarks || `${line.activity_name} — scheduled entry`,
          } as any,
          tenantId,
          userPayload,
        );
        // No created_at in this projection to sort by — the newly-inserted row is
        // reliably last for a simple unordered SELECT against an append-only table.
        const matchingTx = (updated.transactions || []).filter(
          (t: any) =>
            t.transaction_date === dto.entry_date &&
            t.item_id === resolvedItemId &&
            t.transaction_type === line.line_type,
        );
        posted = true;
        postingReference = matchingTx[matchingTx.length - 1]?.transaction_id || null;
        break;
      }
      case 'DESCRIPTIVE': {
        if (dto.entered_value == null && !dto.entered_text) {
          throw new BadRequestException(
            'Enter a value or text for this line.',
          );
        }
        if (dto.entered_value != null) {
          const minVal =
            line.lower_alert_limit != null
              ? Number(line.lower_alert_limit)
              : -Infinity;
          const maxVal =
            line.upper_alert_limit != null
              ? Number(line.upper_alert_limit)
              : Infinity;
          if (dto.entered_value < minVal || dto.entered_value > maxVal) {
            alertTriggered = true;
            alertNote = `${line.activity_name}: ${dto.entered_value} outside [${line.lower_alert_limit ?? '-∞'}, ${line.upper_alert_limit ?? '∞'}]`;
            await this.db.insert(schema.notificationAlertLog).values({
              alert_id: randomUUID(),
              tenant_id: tenantId,
              company_id: header.company_id,
              lob_id: header.lob_id,
              batch_id: batchId,
              line_id: line.line_id,
              alert_type: 'KPI_DEVIATION',
              severity:
                line.alert_severity === 'INFO' ||
                line.alert_severity === 'CRITICAL'
                  ? line.alert_severity
                  : 'WARNING',
              title: `${line.activity_name} Out of Range — Batch Schedule`,
              message: alertNote,
              activity_name: line.activity_name,
              kpi_mode: 'VALUE',
              expected_value: line.std_value,
              actual_value: dto.entered_value.toString(),
              kpi_min: line.lower_alert_limit,
              kpi_max: line.upper_alert_limit,
            });
          }
        }
        // "Animal count... updated daily from batch_daily_data" (Schedule_master_template.xlsx).
        // HEAD_COUNT is an absolute daily count; MORTALITY_COUNT is a delta against
        // whatever was already recorded for this line+date, so a farmer correcting
        // today's mortality entry doesn't double-decrement animal_count.
        if (
          dto.entered_value != null &&
          (line.kpi_metric === 'HEAD_COUNT' ||
            line.kpi_metric === 'MORTALITY_COUNT')
        ) {
          let newCount: number;
          if (line.kpi_metric === 'HEAD_COUNT') {
            newCount = dto.entered_value;
          } else {
            const existingWhere = dto.animal_id
              ? and(
                  eq(schema.batchDailyData.line_id, line.line_id),
                  eq(schema.batchDailyData.entry_date, dto.entry_date),
                  eq(schema.batchDailyData.animal_id, dto.animal_id),
                )
              : and(
                  eq(schema.batchDailyData.line_id, line.line_id),
                  eq(schema.batchDailyData.entry_date, dto.entry_date),
                );
            const [existing] = await this.db
              .select({ entered_value: schema.batchDailyData.entered_value })
              .from(schema.batchDailyData)
              .where(existingWhere)
              .limit(1);
            const previousEntered =
              existing?.entered_value != null
                ? Number(existing.entered_value)
                : 0;
            const delta = dto.entered_value - previousEntered;
            newCount = Math.max(0, Number(header.animal_count) - delta);

            // Keep animal_register in step with the reported death count — without
            // this, a stage transition re-derives animal_count from animal_register's
            // own live count (createForStage()) and silently reverts the mortality
            // this line just recorded. Only handles a net *increase* in deaths
            // (delta > 0); a downward correction has no unambiguous animal to
            // "revive" so animal_count above is still corrected, just not the registry.
            const deathsToRecord = Math.round(delta);
            // ANIMAL_WISE names the exact animal on the entry — mark it directly
            // instead of FIFO-guessing which of the stage's animals died.
            const dying = dto.animal_id
              ? deathsToRecord > 0
                ? [{ animal_id: dto.animal_id }]
                : []
              : deathsToRecord > 0
                ? await this.db
                    .select({ animal_id: schema.animalRegister.animal_id })
                    .from(schema.animalRegister)
                    .where(
                      and(
                        eq(schema.animalRegister.current_batch_id, batchId),
                        eq(
                          schema.animalRegister.current_stage_id,
                          header.stage_id,
                        ),
                        eq(schema.animalRegister.is_active, true),
                        sql`${schema.animalRegister.status} NOT IN ('DEAD','SOLD','CULLED','SLAUGHTERED')`,
                      ),
                    )
                    .orderBy(schema.animalRegister.created_at)
                    .limit(deathsToRecord)
                : [];
            if (dying.length) {
              await this.db
                .update(schema.animalRegister)
                .set({
                  is_active: false,
                  status: 'DEAD',
                  disposal_type: 'DIED',
                  disposal_date: dto.entry_date,
                  updated_by: userPayload?.userId || null,
                  updated_at: toMysqlTimestamp(),
                })
                .where(
                  inArray(
                    schema.animalRegister.animal_id,
                    dying.map((a) => a.animal_id),
                  ),
                );

              // AnimalService.dispose() logs MORTALITY on the same registry
              // flip — this scheduler-driven path was silently skipping it,
              // leaving these deaths invisible to the HISTORY/LOCATION tabs.
              for (const dead of dying) {
                await this.movementLog.record({
                  tenantId,
                  companyId: batchRow?.company_id,
                  animalId: dead.animal_id,
                  movementType: 'MORTALITY',
                  eventDate: dto.entry_date,
                  fromBatchId: batchId,
                  fromStageId: header.stage_id,
                  reason: 'Recorded via daily mortality count entry',
                  userId: userPayload?.userId,
                });
              }
            }
          }
          await this.db
            .update(schema.schedulerHeader)
            .set({
              animal_count: newCount.toString(),
              updated_at: toMysqlTimestamp(),
            })
            .where(
              eq(schema.schedulerHeader.scheduler_id, header.scheduler_id),
            );
        }

        // Transaction Ledger Structure (Row 11): Record DESCRIPTIVE entry into inventory_ledger only if non-zero value
        const valNum = dto.entered_value != null ? Number(dto.entered_value) : 0;
        if (Math.abs(valNum) > 0.0001) {
          await this.db.insert(schema.inventoryLedger).values({
            ledger_id: randomUUID(),
            tenant_id: tenantId,
            company_id: header.company_id,
            item_id: line.item_id || null,
            item_code: line.kpi_metric || 'DESCRIPTIVE',
            item_description: line.activity_name,
            document_type: 'BATCH',
            document_no: batchRow?.batch_no || batchId,
            document_line_id: line.line_id,
            posting_date: dto.entry_date,
            external_reference_no: dto.entered_text || null,
            entry_type: 'DESCRIPTIVE',
            transaction_type: 'DESCRIPTIVE',
            quantity: valNum.toString(),
            remaining_quantity: null,
            uom: line.kpi_uom || 'OBSERVATION',
            rate: '0',
            amount: '0',
            batch_no: batchRow?.batch_no || null,
            location_id: header.location_id || batchRow?.location_id || null,
            warehouse_id: batchRow?.shed_id || header.location_id || null,
            nob_id: header.nob_id || null,
            lob_id: header.lob_id,
            created_by: userPayload?.userId || null,
          });
        }
        posted = true;
        break;
      }
      case 'OVERHEAD':
      case 'RESOURCE': {
        if (dto.entered_value == null)
          throw new BadRequestException(
            'Enter a value for this line.',
          );
        let quantity = dto.entered_value;
        let rate = dto.rate ?? null;
        let resourceId = line.resource_id;

        if (line.line_type === 'RESOURCE') {
          if (!resourceId) {
            // Fallback 1: check if activity_master has default_resource_id
            try {
              const [act] = await this.db
                .select({ default_resource_id: schema.activityMaster.default_resource_id })
                .from(schema.activityMaster)
                .where(
                  and(
                    eq(schema.activityMaster.tenant_id, tenantId),
                    eq(schema.activityMaster.activity_name, line.activity_name),
                  ),
                )
                .limit(1);
              if (act?.default_resource_id) {
                resourceId = act.default_resource_id;
              }
            } catch {
              // ignore
            }

            // Fallback 2: check if any active LABOR or matching resource exists
            if (!resourceId) {
              try {
                const [matchedRes] = await this.db
                  .select({ resource_id: schema.resourceMaster.resource_id, cost_rate: schema.resourceMaster.cost_rate })
                  .from(schema.resourceMaster)
                  .where(
                    and(
                      eq(schema.resourceMaster.tenant_id, tenantId),
                      eq(schema.resourceMaster.is_active, true),
                      or(
                        eq(schema.resourceMaster.resource_name, line.activity_name),
                        eq(schema.resourceMaster.resource_type, 'LABOR'),
                      ),
                    ),
                  )
                  .limit(1);
                if (matchedRes) {
                  resourceId = matchedRes.resource_id;
                  if (rate == null && matchedRes.cost_rate != null) {
                    rate = Number(matchedRes.cost_rate);
                  }
                }
              } catch {
                // ignore
              }
            }
          }

          if (rate == null && resourceId) {
            try {
              const [resource] = await this.db
                .select()
                .from(schema.resourceMaster)
                .where(eq(schema.resourceMaster.resource_id, resourceId))
                .limit(1);
              rate =
                resource?.cost_rate != null ? Number(resource.cost_rate) : null;
            } catch {
              // ignore
            }
          }

          // If still no rate is set, default to 0 so unpriced operational tasks don't block posting the day
          if (rate == null) {
            rate = 0;
          }
        } else if (rate == null) {
          // OVERHEAD lines are naturally entered as a single day's total cost —
          // quantity 1 x rate = that amount, rather than asking the farmer to
          // split a utility bill into a unit rate they don't track.
          rate = quantity;
          quantity = 1;
        }

        const updated = await this.batchService.addTransaction(
          batchId,
          {
            transaction_date: dto.entry_date,
            transaction_type: 'OVERHEAD',
            resource_id: resourceId || undefined,
            quantity,
            rate: rate ?? 0,
            animal_id: dto.animal_id,
            remarks: dto.remarks || `${line.activity_name} — scheduled entry`,
          } as any,
          tenantId,
          userPayload,
        );
        const matchingTx = (updated.transactions || []).filter(
          (t: any) =>
            t.transaction_date === dto.entry_date &&
            t.transaction_type === 'OVERHEAD',
        );
        posted = true;
        postingReference =
          matchingTx[matchingTx.length - 1]?.transaction_id || null;

        // Transaction Ledger Structure (Row 11): Record OVERHEAD entry into inventory_ledger only if non-zero amount
        const totalAmount = Number((quantity * (rate ?? 0)).toFixed(4));
        if (Math.abs(totalAmount) > 0.0001) {
          await this.db.insert(schema.inventoryLedger).values({
            ledger_id: randomUUID(),
            tenant_id: tenantId,
            company_id: header.company_id,
            item_id: line.item_id || null,
            item_code: line.line_type === 'RESOURCE' ? (line.activity_name || 'RESOURCE') : 'OVERHEAD',
            item_description: dto.remarks || line.activity_name,
            document_type: 'BATCH',
            document_no: batchRow?.batch_no || batchId,
            document_line_id: matchingTx[matchingTx.length - 1]?.transaction_id || line.line_id,
            posting_date: dto.entry_date,
            external_reference_no: dto.remarks || null,
            entry_type: 'OVERHEAD',
            transaction_type: 'OVERHEAD',
            quantity: (-Math.abs(quantity)).toString(),
            remaining_quantity: null,
            uom: 'PCS',
            rate: (rate ?? 0).toString(),
            amount: (-Math.abs(totalAmount)).toString(),
            batch_no: batchRow?.batch_no || null,
            location_id: header.location_id || batchRow?.location_id || null,
            warehouse_id: batchRow?.shed_id || header.location_id || null,
            nob_id: header.nob_id || null,
            lob_id: header.lob_id,
            created_by: userPayload?.userId || null,
          });
        }
        break;
      }
      case 'TRANSFER': {
        if (!dto.destination_batch_id)
          throw new BadRequestException(
            'A transfer line needs a destination batch.',
          );
        // Animal-wise entries already name the exact animal — that's the whole
        // transfer, no FIFO guess needed. Whole-batch entries only say how many
        // head to move, scoped to this line's own stage (an ANIMAL_WISE batch's
        // other stages are none of this header's business).
        let candidateIds: string[];
        if (dto.animal_id) {
          candidateIds = [dto.animal_id];
        } else {
          if (dto.entered_value == null && line.standard_qty == null) {
            throw new BadRequestException(
              "Enter how many head to move (or set the line's standard quantity).",
            );
          }
          const headcount = Math.round(
            dto.entered_value ?? Number(line.standard_qty),
          );
          // Auto-select the oldest still-in-this-batch animals up to the requested
          // headcount — the schedule line only says how many move, not which ones;
          // FIFO-by-registration is the same order the rest of the app already
          // assumes when it doesn't have a farmer's explicit pick.
          const candidates = await this.db
            .select({ animal_id: schema.animalRegister.animal_id })
            .from(schema.animalRegister)
            .where(
              and(
                eq(schema.animalRegister.current_batch_id, batchId),
                eq(schema.animalRegister.current_stage_id, header.stage_id),
                eq(schema.animalRegister.is_active, true),
              ),
            )
            .orderBy(schema.animalRegister.created_at)
            .limit(headcount);
          candidateIds = candidates.map((c) => c.animal_id);
        }
        if (!candidateIds.length) {
          throw new ConflictException(
            `No animals currently in batch '${batchId}' to transfer.`,
          );
        }
        const transferResult = await this.batchTransferService.create(
          {
            company_id: header.company_id,
            to_batch_id: dto.destination_batch_id,
            transfer_date: dto.entry_date,
            transfer_type: 'PARTIAL',
            animal_ids: candidateIds,
            reason: line.activity_name,
            remarks: dto.remarks,
            auto_triggers_stage: line.auto_triggers_stage,
          } as any,
          tenantId,
          batchId,
          userPayload,
        );
        posted = true;
        postingReference =
          (transferResult as any)?.transfer_id || dto.destination_batch_id;
        break;
      }
      default:
        throw new BadRequestException(`Unknown line type '${line.line_type}'.`);
    }

    await this.recordEntry({
      entryId,
      tenantId,
      userPayload,
      dto,
      line,
      header,
      batchId,
      posted,
      postingReference,
      alertTriggered,
      alertNote,
      remarks: dailyRemarks,
    });

    // CONSUMPTION re-checks the silo levels in postConsumptionGroup. Of the lines that reach here only OUTPUT
    // moves item stock; the rest (overhead, resources, animal transfers) leave every silo where it was. This
    // method opens no transaction of its own, so each write above has committed by here; the evaluation itself
    // never throws (Ruling M6).
    if (!opts.deferFeedAlerts && line.line_type === 'OUTPUT') {
      await this.reevaluateFeedLevels(batchRow?.farm_id, tenantId);
    }

    return this.findForDate(batchId, dto.entry_date, tenantId);
  }

  /** Writes the day's row for an entry — posted or not — and its audit line. */
  private async recordEntry(args: {
    entryId: string;
    tenantId: string;
    userPayload?: UserContext;
    dto: CreateBatchDailyDataDto;
    line: { line_id: string };
    header: { company_id: string };
    batchId: string;
    posted: boolean;
    postingReference: string | null;
    alertTriggered: boolean;
    alertNote: string | null;
    remarks: string | null | undefined;
  }) {
    const { entryId, tenantId, userPayload, dto, line, header, batchId, posted, postingReference, alertTriggered, alertNote, remarks } = args;
    await this.db
      .insert(schema.batchDailyData)
      .values({
        entry_id: entryId,
        tenant_id: tenantId,
        company_id: header.company_id,
        line_id: line.line_id,
        batch_id: batchId,
        animal_id: dto.animal_id || null,
        entry_date: dto.entry_date,
        entered_value: dto.entered_value?.toString() ?? null,
        entered_text: dto.entered_text || null,
        lot_no: dto.lot_no || null,
        serial_no: dto.serial_no || null,
        posted,
        posting_reference: postingReference,
        alert_triggered: alertTriggered,
        alert_note: alertNote,
        remarks: remarks || null,
        created_by: userPayload?.userId || null,
        updated_by: userPayload?.userId || null,
      })
      .onDuplicateKeyUpdate({
        set: {
          entered_value: dto.entered_value?.toString() ?? null,
          entered_text: dto.entered_text || null,
          lot_no: dto.lot_no || null,
          serial_no: dto.serial_no || null,
          posted,
          posting_reference: postingReference,
          alert_triggered: alertTriggered,
          alert_note: alertNote,
          remarks: remarks || null,
          updated_by: userPayload?.userId || null,
          updated_at: toMysqlTimestamp(),
        },
      });

    await this.auditService.log({
      tenantId,
      companyId: header.company_id,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'batch_daily_data',
      entityId: entryId,
      newValues: { line_id: line.line_id, batch_id: batchId, entry_date: dto.entry_date },
    });
  }

  /**
   * Issues the consumptions a day post collected. Entries for the same activity (line, item, location, date,
   * lots) are issued together as ONE ledger entry, whatever the number of animals; entries with serial
   * numbers are issued one by one, since each names its own units.
   */
  async postCollected(collected: PendingConsumption[]): Promise<void> {
    const groups = new Map<string, PendingConsumption[]>();
    for (const p of collected) {
      const key = p.dto.serial_no
        ? `serial|${p.entryId}`
        : [p.line.line_id, p.resolvedItemId, p.sourceWarehouseId ?? '', p.dto.entry_date, p.dto.lot_no ?? ''].join('|');
      groups.set(key, [...(groups.get(key) ?? []), p]);
    }
    for (const group of groups.values()) await this.postConsumptionGroup(group);
  }

  /**
   * One activity's consumption for a group of entries (a single entry is a group of one): the quantities are
   * added, the lots chosen are filled in order, a silo that is short gives what it has and the farm store the
   * rest, and each location issued from gets one ledger entry. Every animal keeps its own share of the
   * quantity and the cost (see BatchService.postConsumptionGroup), and its own daily row.
   */
  private async postConsumptionGroup(group: PendingConsumption[]): Promise<void> {
    const first = group[0];
    const { dto, line, header, item, resolvedItemId, tenantId, userPayload, batchId } = first;
    const shares = group.map((p) => ({ animal_id: p.dto.animal_id, quantity: Number(p.dto.entered_value) }));
    const total = round(shares.reduce((n, s) => n + s.quantity, 0));

    // Which lots, in what order — several ticked lots are filled from the nearest expiry on.
    const lotResult = await this.planLots({ ...dto, entered_value: total }, line, item?.item_type, resolvedItemId, first.sourceWarehouseId, header.company_id, tenantId, Boolean(item?.is_lot_tracked));
    const allocations = lotResult.shares;
    const lots = allocations.length > 1 ? allocations.map((a) => ({ lotNo: a.lot_no as string, quantity: a.quantity as number })) : undefined;
    const singleLot = allocations.length === 1 ? allocations[0].lot_no : undefined;

    // A silo that holds the item but not enough of it gives what it has and the farm store the rest.
    const split =
      !lots && !singleLot && !dto.serial_no && first.sourceWarehouseId
        ? await this.splitSiloShortfall(first.sourceWarehouseId, resolvedItemId, total, first.farmId, header.company_id, tenantId)
        : null;
    const parts: Array<{ warehouseId: string | undefined; quantity: number }> = split
      ? split.shares
      : [{ warehouseId: first.sourceWarehouseId, quantity: total }];
    const sharesByPart = allocateSharesToParts(shares, parts);

    const posted: Array<{ transactions: Array<{ transaction_id: string; animal_id?: string }> }> = [];
    const issue = async () => {
      for (let i = 0; i < parts.length; i++) {
        posted.push(
          await this.batchService.postConsumptionGroup(
            batchId,
            {
              item_id: resolvedItemId,
              uom: item?.uom_primary || 'PCS',
              transaction_date: dto.entry_date,
              source_warehouse_id: parts[i].warehouseId,
              lots,
              lot_no: lots ? undefined : singleLot ?? dto.lot_no,
              serial_no: dto.serial_no,
              remarks: dto.remarks || `${line.activity_name} — scheduled entry`,
              shares: sharesByPart[i],
            },
            tenantId,
            userPayload,
          ),
        );
      }
    };
    // The locations issue together or not at all.
    if (parts.length > 1) await withTenantTransaction(this.cls, issue);
    else await issue();

    // What each animal's daily row records about how the stock was drawn.
    const notes = [...lotResult.notes];
    if (lots) notes.push(`Lots: ${lots.map((l) => `${l.lotNo} ×${l.quantity}`).join(', ')}`);
    if (split) notes.push(split.note);

    const reference = (animalId: string | undefined) =>
      posted.flatMap((p) => p.transactions).find((t) => (t.animal_id ?? undefined) === animalId)?.transaction_id ?? null;
    for (const p of group) {
      await this.recordEntry({
        entryId: p.entryId,
        tenantId,
        userPayload,
        dto: p.dto,
        line,
        header,
        batchId,
        posted: true,
        postingReference: reference(p.dto.animal_id),
        alertTriggered: false,
        alertNote: null,
        remarks: notes.length ? `${p.dto.remarks ? `${p.dto.remarks} — ` : ''}${notes.join('; ')}`.slice(0, 500) : p.dto.remarks,
      });
    }
    if (group.some((p) => !p.deferFeedAlerts)) await this.reevaluateFeedLevels(first.farmId, tenantId);
  }

  /**
   * Re-checks the silo levels of the batch's farm (checkpoint 12). Public for
   * BatchService's day posts, which defer the per-line check above and call
   * this once after the whole day is in. Never throws.
   */
  async reevaluateFeedLevels(farmId: string | null | undefined, tenantId: string): Promise<void> {
    await this.feedAlerts?.evaluateLevelsSafely([farmId], tenantId);
  }

  /**
   * Where a scheduled CONSUMPTION line's stock is actually drawn from.
   *
   * The client's feed flow (2026-09-24) is farm STORE -> (stock transfer) ->
   * SILO -> (daily entry) -> shed. A shed may now draw from several silos
   * (silo_shed_link, Task 1), so the source is whichever of this shed's
   * silos currently holds the item this line is posting (D9: a silo holds
   * one feed item, so at most one of them can) — SiloFeedService.currentItems
   * is the single place that reads silo residency. Data entry happens at PEN
   * level on some farms, and a silo is attached to the shed above the pen,
   * never to the pen itself, so a PEN walks up its parent first.
   *
   * With no attached silo holding this item — none linked at all, or none of
   * them carrying it — the farm's STORE is the source, and that is a real
   * answer rather than a stopgap: bagged feed (location_master.feed_in_bags,
   * carried per location on both client templates) genuinely is carried out
   * of the store, never blown into a silo. It also keeps every farm posting
   * entries from the day it is created, before anyone has configured silos.
   *
   * If neither resolves there is nowhere honest to take the stock from, and
   * guessing would put the batch's cost against another farm's inventory —
   * which is exactly what the warehouse-less ledger row used to do.
   *
   * Public so the demo's chapter 04 can size its silo top-ups against the
   * very warehouse each entry will draw from, rather than a second copy of
   * this rule that could drift from it.
   */
  async resolveConsumptionWarehouse(
    locationId: string | null,
    itemId: string,
    activityName: string | null,
    batchFarmId: string | null,
    companyId: string,
    tenantId: string,
  ): Promise<string> {
    const columns = {
      location_id: schema.locationMaster.location_id,
      location_type: schema.locationMaster.location_type,
      parent_location_id: schema.locationMaster.parent_location_id,
      farm_id: schema.locationMaster.farm_id,
    };
    // The farm's own store, which every fallback below ends at.
    const storeOfFarm = (farmId: string | null) => this.storeOfFarm(farmId);

    // A scheduler that records no shed or pen is not a reason to refuse the
    // entry: plenty of batches are scheduled at farm level, and the feed still
    // came from somewhere. The batch's own farm store is that somewhere, and
    // refusing instead would have blocked every farm-level batch in the demo —
    // which is exactly how this surfaced.
    const [location] = locationId
      ? await this.db
          .select(columns)
          .from(schema.locationMaster)
          .where(eq(schema.locationMaster.location_id, locationId))
          .limit(1)
      : [undefined];
    if (!location) {
      const store = await storeOfFarm(batchFarmId);
      if (store) return store;
      throw new BadRequestException(
        `'${activityName ?? 'This line'}' cannot be posted — its stage records no shed or pen, and the batch's farm has no store to draw from. Set the batch's location, or create the farm's store location.`,
      );
    }

    let shed = location;
    if (location.location_type === 'PEN' && location.parent_location_id) {
      const [parent] = await this.db
        .select(columns)
        .from(schema.locationMaster)
        .where(eq(schema.locationMaster.location_id, location.parent_location_id))
        .limit(1);
      if (parent) shed = parent;
    }

    // Every silo linked to this shed (there may be several, or none) — the
    // source is whichever one currently holds the item being posted.
    // Bounded by tenant and by the silo still being live, the same rows the
    // feed forecast reads (feed-forecast.service.ts loadInput): a link left
    // pointing at a retired or deleted silo must not be drawn from here while
    // the forecast shows the shed falling through to the store.
    const siloLinks = await this.db
      .select({ silo_id: schema.siloShedLink.silo_id })
      .from(schema.siloShedLink)
      .innerJoin(schema.locationMaster, eq(schema.locationMaster.location_id, schema.siloShedLink.silo_id))
      .where(
        and(
          eq(schema.siloShedLink.tenant_id, tenantId),
          eq(schema.siloShedLink.shed_id, shed.location_id),
          eq(schema.locationMaster.is_active, true),
          isNull(schema.locationMaster.deleted_at),
        ),
      );
    if (siloLinks.length > 0) {
      const siloIds = siloLinks.map((link) => link.silo_id);
      const residents = await this.siloFeedService.currentItems(siloIds, companyId, tenantId);
      const holdingSiloId = siloIds.find((siloId) => residents.get(siloId)?.item_id === itemId);
      if (holdingSiloId) return holdingSiloId;
    }

    // farm_id is stamped on every descendant of a FARM (see the location
    // seeder); a shed sitting directly under the farm with no farm_id falls
    // back to its parent, which is that farm.
    const store = await storeOfFarm(shed.farm_id || shed.parent_location_id || batchFarmId);
    if (store) return store;

    throw new BadRequestException(
      `'${activityName ?? 'This line'}' cannot be posted — no silo attached to this batch's shed holds this item, and its farm has no store to draw from. Attach or fill a silo for this item, or create the farm's store location.`,
    );
  }

  /** The farm's own active store, first by code — the one the feed forecast reports. */
  private async storeOfFarm(farmId: string | null): Promise<string | null> {
    if (!farmId) return null;
    const [store] = await this.db
      .select({ location_id: schema.locationMaster.location_id })
      .from(schema.locationMaster)
      .where(
        and(
          eq(schema.locationMaster.location_type, 'STORE'),
          eq(schema.locationMaster.is_active, true),
          isNull(schema.locationMaster.deleted_at),
          or(
            eq(schema.locationMaster.farm_id, farmId),
            eq(schema.locationMaster.parent_location_id, farmId),
          ),
        ),
      )
      // First by code, as the feed forecast picks a farm's store, so a farm
      // that somehow carries two draws on the one the forecast reports.
      .orderBy(schema.locationMaster.location_code)
      .limit(1);
    return store?.location_id ?? null;
  }

  /**
   * A silo that holds the item but has less of it than the entry needs: the silo gives what it has
   * and the farm's store the rest, as two shares of one entry. Returns null — the entry draws from
   * its one resolved location as before — when the source is not a silo, the silo covers it, the
   * farm has no store, or the store is the source already.
   */
  private async splitSiloShortfall(
    warehouseId: string,
    itemId: string,
    quantity: number,
    farmId: string | null,
    companyId: string,
    tenantId: string,
  ): Promise<{ shares: Array<{ quantity: number; warehouseId: string }>; note: string } | null> {
    const [source] = await this.db
      .select({ type: schema.locationMaster.location_type, code: schema.locationMaster.location_code })
      .from(schema.locationMaster)
      .where(eq(schema.locationMaster.location_id, warehouseId))
      .limit(1);
    if (source?.type !== 'SILO') return null;
    const [held] = await this.db
      .select({ total: sql<string>`COALESCE(SUM(${schema.inventoryLedger.remaining_quantity}), 0)` })
      .from(schema.inventoryLedger)
      .where(
        and(
          eq(schema.inventoryLedger.tenant_id, tenantId),
          eq(schema.inventoryLedger.company_id, companyId),
          eq(schema.inventoryLedger.warehouse_id, warehouseId),
          eq(schema.inventoryLedger.item_id, itemId),
          inArray(schema.inventoryLedger.entry_type, ['POSITIVE', 'TRANSFER']),
        ),
      );
    const inSilo = round(Number(held?.total ?? 0));
    if (inSilo >= quantity - 0.0001) return null;
    const storeId = await this.storeOfFarm(farmId);
    if (!storeId || storeId === warehouseId) return null;
    const [store] = await this.db
      .select({ code: schema.locationMaster.location_code })
      .from(schema.locationMaster)
      .where(eq(schema.locationMaster.location_id, storeId))
      .limit(1);
    const rest = round(quantity - inSilo);
    const shares = [
      ...(inSilo > 0 ? [{ quantity: inSilo, warehouseId }] : []),
      { quantity: rest, warehouseId: storeId },
    ];
    const note = `Drawn: ${inSilo > 0 ? `${source.code} ×${inSilo}, ` : ''}${store?.code ?? 'farm store'} ×${rest}`;
    return { shares, note };
  }

  /**
   * The shares a consumption posts as, and what to record about them. One lot (or none) is the single
   * share it always was. Several lots ticked are filled in order from what each holds at the location
   * the entry draws from, and the entry is refused — before anything posts — when they cannot cover it.
   *
   * Rules on the lots chosen: an expired lot of a medicine or vaccine is refused (feed is allowed, and
   * noted); a lot chosen against the suggestion — the usable lot with the earliest expiry, then the
   * oldest receipt — is allowed and noted as an override, so it can be found afterwards.
   */
  private async planLots(
    dto: CreateBatchDailyDataDto,
    line: { line_type: string; activity_name: string },
    itemType: string | null | undefined,
    itemId: string,
    warehouseId: string | undefined,
    companyId: string,
    tenantId: string,
    lotTracked = false,
  ): Promise<{ shares: Array<{ lot_no?: string; quantity: number | undefined }>; notes: string[] }> {
    const lots = parseLotList(dto.lot_no);
    if (line.line_type !== 'CONSUMPTION' || dto.serial_no || (lots.length === 0 && !lotTracked)) {
      return { shares: [{ lot_no: dto.lot_no, quantity: dto.entered_value }], notes: [] };
    }
    // What each lot holds at this location, read off the lots themselves (not any receipt's remaining quantity).
    const rows = await lotBalances(this.db, { tenantId, companyId, itemId, warehouseId });
    const today = new Date().toISOString().slice(0, 10);
    const stock = rows
      .map((r) => ({ lot_no: r.lot_no, remaining: r.quantity, expiry_date: r.expiry_date, receipt_date: r.receipt_date }))
      .filter((r) => r.remaining > 0.0001);
    const isExpired = (l: { expiry_date: string | null }) => !!l.expiry_date && String(l.expiry_date).slice(0, 10) < today;
    const notes: string[] = [];

    // A lot-tracked item posted with no lot named (a bulk entry, a seed, an API client): the stock leaves
    // the in-date lot with the nearest expiry first, then the next, exactly as the picker would have suggested.
    // Expired stock is never taken on the system's own choice.
    if (lots.length === 0) {
      const usable = stock.filter((l) => !isExpired(l));
      const quantity = Number(dto.entered_value);
      const { allocations, shortBy } = allocateAcrossLots(usable, quantity, today);
      if (shortBy > 0.0001) {
        const held = usable.reduce((n, l) => n + l.remaining, 0);
        throw new BadRequestException(
          `'${line.activity_name}': ${round(held)} in date${warehouseId ? ' at this location' : ''}, ${round(shortBy)} short of ${quantity} — name the lots to use (an expired lot must be chosen deliberately) or lower the quantity.`,
        );
      }
      notes.push(`Lots chosen by nearest expiry: ${allocations.map((a) => `${a.lot_no} ${a.quantity}`).join(', ')}`);
      return { shares: allocations, notes };
    }

    const chosen = orderLots(stock.filter((s) => lots.includes(s.lot_no)), today);

    const expired = chosen.filter(isExpired);
    if (expired.length) {
      const named = expired.map((l) => `${l.lot_no} (expired ${String(l.expiry_date).slice(0, 10)})`).join(', ');
      if (itemType === 'MEDICINE' || itemType === 'VACCINE') {
        throw new BadRequestException(`'${line.activity_name}': ${named} — expired medicine and vaccine cannot be used. Choose a lot that is in date.`);
      }
      notes.push(`Expired lot used: ${expired.map((l) => l.lot_no).join(', ')}`);
    }
    const suggested = orderLots(stock, today).find((l) => !isExpired(l));
    if (suggested && chosen.length && chosen[0].lot_no !== suggested.lot_no) {
      notes.push(`Lot override: used ${chosen[0].lot_no}, suggested ${suggested.lot_no}`);
    }

    if (lots.length === 1) return { shares: [{ lot_no: dto.lot_no, quantity: dto.entered_value }], notes };

    const quantity = Number(dto.entered_value);
    const { allocations, shortBy } = allocateAcrossLots(chosen, quantity, today);
    if (shortBy > 0.0001) {
      const held = lots.map((l) => `${l} (${chosen.find((s) => s.lot_no === l)?.remaining ?? 0})`).join(', ');
      throw new BadRequestException(
        `'${line.activity_name}': the lots ticked hold ${held}${warehouseId ? ' at this location' : ''}, ${round(shortBy)} short of ${quantity} — tick another lot or lower the quantity.`,
      );
    }
    return { shares: allocations, notes };
  }

  /**
   * Where a CONSUMPTION line will draw its stock — the same answer posting uses
   * (`resolveConsumptionWarehouse`), asked before posting so the lot and serial pickers can list only
   * what is at that location. Returns no warehouse, with the reason, when nowhere resolves: the page
   * then shows the pickers unscoped and posting gives the real refusal.
   */
  async consumptionSourceForLine(batchId: string, lineId: string, tenantId: string) {
    await this.batchService.findOne(batchId);
    const [row] = await this.db
      .select({
        item_id: schema.schedulerLine.item_id,
        activity_name: schema.schedulerLine.activity_name,
        line_type: schema.schedulerLine.line_type,
        batch_id: schema.schedulerHeader.batch_id,
        company_id: schema.schedulerHeader.company_id,
        location_id: schema.schedulerHeader.location_id,
        farm_id: schema.batchHeader.farm_id,
      })
      .from(schema.schedulerLine)
      .innerJoin(schema.schedulerHeader, eq(schema.schedulerHeader.scheduler_id, schema.schedulerLine.scheduler_id))
      .innerJoin(schema.batchHeader, eq(schema.batchHeader.batch_id, schema.schedulerHeader.batch_id))
      .where(eq(schema.schedulerLine.line_id, lineId))
      .limit(1);
    if (!row || row.batch_id !== batchId) throw new NotFoundException(`Scheduler line '${lineId}' not found on this batch.`);
    if (row.line_type !== 'CONSUMPTION' || !row.item_id) {
      return { warehouse_id: null, warehouse_code: null, warehouse_name: null, location_type: null, message: 'This line draws no stock.' };
    }
    try {
      const warehouseId = await this.resolveConsumptionWarehouse(row.location_id, row.item_id, row.activity_name, row.farm_id, row.company_id, tenantId);
      const [where] = await this.db
        .select({ code: schema.locationMaster.location_code, name: schema.locationMaster.location_name, type: schema.locationMaster.location_type })
        .from(schema.locationMaster)
        .where(eq(schema.locationMaster.location_id, warehouseId))
        .limit(1);
      return { warehouse_id: warehouseId, warehouse_code: where?.code ?? null, warehouse_name: where?.name ?? null, location_type: where?.type ?? null, message: null };
    } catch (err) {
      if (err instanceof BadRequestException) {
        return { warehouse_id: null, warehouse_code: null, warehouse_name: null, location_type: null, message: err.message };
      }
      throw err;
    }
  }

  async findForDate(batchId: string, entryDate: string, tenantId: string) {
    await this.batchService.findOne(batchId);
    return this.db
      .select()
      .from(schema.batchDailyData)
      .where(
        and(
          eq(schema.batchDailyData.batch_id, batchId),
          eq(schema.batchDailyData.entry_date, entryDate),
          eq(schema.batchDailyData.tenant_id, tenantId),
        ),
      );
  }
}
