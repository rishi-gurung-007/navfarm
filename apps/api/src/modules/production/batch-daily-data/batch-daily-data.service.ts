import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, inArray, or, sql, isNull } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { CreateBatchDailyDataDto } from './dto/batch-daily-data.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { BatchService, type UserContext } from '../batch/batch.service';
import { BatchTransferService } from '../batch/batch-transfer.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { AnimalMovementLogService } from '../../piggery/animal-movement-log/animal-movement-log.service';

const toMysqlTimestamp = (date: Date = new Date()) =>
  date.toISOString().slice(0, 19).replace('T', ' ');

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
    if (line.lot_required && !dto.lot_no) {
      throw new BadRequestException(
        `'${line.activity_name}' requires a lot number.`,
      );
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
        `Batch '${batchId}' is ANIMAL_WISE — animal_id is required for data entry.`,
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
        (existingRow.lot_no || null) === (dto.lot_no || null);
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

    switch (line.line_type) {
      case 'CONSUMPTION':
      case 'OUTPUT': {
        if (!line.item_id)
          throw new ConflictException(
            `'${line.activity_name}' has no item configured — fix the line before posting entries against it.`,
          );
        if (dto.entered_value == null)
          throw new BadRequestException(
            'entered_value is required for this line.',
          );
        const [item] = await this.db
          .select()
          .from(schema.itemMaster)
          .where(eq(schema.itemMaster.item_id, line.item_id))
          .limit(1);
        // Feed and medicine come out of somewhere physical: the silo standing
        // at this batch's shed, or the farm store behind it. Only CONSUMPTION
        // draws stock down — an OUTPUT line puts stock IN and has no source to
        // resolve, so it is left exactly as it was.
        const sourceWarehouseId =
          line.line_type === 'CONSUMPTION'
            ? await this.resolveConsumptionWarehouse(
                header.location_id,
                line.activity_name,
                batchRow?.farm_id ?? null,
              )
            : undefined;
        const updated = await this.batchService.addTransaction(
          batchId,
          {
            transaction_date: dto.entry_date,
            transaction_type: line.line_type,
            item_id: line.item_id,
            quantity: dto.entered_value,
            uom: item?.uom_primary || 'PCS',
            rate: dto.rate,
            animal_id: dto.animal_id,
            // Threaded down to InventoryLedgerService.applyFifo, which only
            // considers layers received into this warehouse. That filter is
            // itself the "is there enough feed in the silo?" check — applyFifo
            // already throws BadRequestException when the layers come up short
            // ("Insufficient stock for item ..."), so no second balance check
            // is written here; one would only be able to disagree with it.
            source_warehouse_id: sourceWarehouseId,
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
            t.item_id === line.item_id &&
            t.transaction_type === line.line_type,
        );
        posted = true;
        postingReference =
          matchingTx[matchingTx.length - 1]?.transaction_id || null;
        break;
      }
      case 'DESCRIPTIVE': {
        if (dto.entered_value == null && !dto.entered_text) {
          throw new BadRequestException(
            'entered_value or entered_text is required for this line.',
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
        break;
      }
      case 'OVERHEAD':
      case 'RESOURCE': {
        if (dto.entered_value == null)
          throw new BadRequestException(
            'entered_value is required for this line.',
          );
        let quantity = dto.entered_value;
        let rate = dto.rate ?? null;
        if (line.line_type === 'RESOURCE') {
          if (!line.resource_id)
            throw new ConflictException(
              `'${line.activity_name}' has no resource configured.`,
            );
          if (rate == null) {
            const [resource] = await this.db
              .select()
              .from(schema.resourceMaster)
              .where(eq(schema.resourceMaster.resource_id, line.resource_id))
              .limit(1);
            rate =
              resource?.cost_rate != null ? Number(resource.cost_rate) : null;
          }
        } else if (rate == null) {
          // OVERHEAD lines are naturally entered as a single day's total cost —
          // quantity 1 x rate = that amount, rather than asking the farmer to
          // split a utility bill into a unit rate they don't track.
          rate = quantity;
          quantity = 1;
        }
        if (rate == null)
          throw new BadRequestException(
            `'${line.activity_name}' needs a rate to post — supply one or set it on the resource.`,
          );
        const updated = await this.batchService.addTransaction(
          batchId,
          {
            transaction_date: dto.entry_date,
            transaction_type: 'OVERHEAD',
            resource_id: line.resource_id || undefined,
            quantity,
            rate,
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
        break;
      }
      case 'TRANSFER': {
        if (!dto.destination_batch_id)
          throw new BadRequestException(
            'TRANSFER lines require destination_batch_id.',
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
              "entered_value (or the line's standard_qty) is required to know how many head to move.",
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
        throw new BadRequestException(`Unknown line_type '${line.line_type}'.`);
    }

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
        posted,
        posting_reference: postingReference,
        alert_triggered: alertTriggered,
        alert_note: alertNote,
        remarks: dto.remarks || null,
        created_by: userPayload?.userId || null,
        updated_by: userPayload?.userId || null,
      })
      .onDuplicateKeyUpdate({
        set: {
          entered_value: dto.entered_value?.toString() ?? null,
          entered_text: dto.entered_text || null,
          lot_no: dto.lot_no || null,
          posted,
          posting_reference: postingReference,
          alert_triggered: alertTriggered,
          alert_note: alertNote,
          remarks: dto.remarks || null,
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
      newValues: {
        line_id: line.line_id,
        batch_id: batchId,
        entry_date: dto.entry_date,
      },
    });

    return this.findForDate(batchId, dto.entry_date, tenantId);
  }

  /**
   * Where a scheduled CONSUMPTION line's stock is actually drawn from.
   *
   * The client's feed flow (2026-09-24) is farm STORE -> (stock transfer) ->
   * SILO -> (daily entry) -> shed, so a shed's feed is whatever its own silo
   * holds — location_master.feed_silo_id, written by the "Attached Sheds"
   * multi-select on the silo form. Data entry happens at PEN level on some
   * farms, and a silo is attached to the shed above the pen, never to the pen
   * itself, so a PEN walks up its parent first.
   *
   * With no silo attached the farm's STORE is the source, and that is a real
   * answer rather than a stopgap: bagged feed (location_master.feed_in_bags,
   * carried per location on both client templates) genuinely is carried out
   * of the store, never blown into a silo. It also keeps every farm posting
   * entries from the day it is created, before anyone has configured silos.
   *
   * If neither resolves there is nowhere honest to take the stock from, and
   * guessing would put the batch's cost against another farm's inventory —
   * which is exactly what the warehouse-less ledger row used to do.
   */
  private async resolveConsumptionWarehouse(
    locationId: string | null,
    activityName: string | null,
    batchFarmId: string | null,
  ): Promise<string> {
    const columns = {
      location_id: schema.locationMaster.location_id,
      location_type: schema.locationMaster.location_type,
      parent_location_id: schema.locationMaster.parent_location_id,
      farm_id: schema.locationMaster.farm_id,
      feed_silo_id: schema.locationMaster.feed_silo_id,
    };
    // The farm's own store, which every fallback below ends at.
    const storeOfFarm = async (farmId: string | null) => {
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
        .limit(1);
      return store?.location_id ?? null;
    };

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

    if (shed.feed_silo_id) return shed.feed_silo_id;

    // farm_id is stamped on every descendant of a FARM (see the location
    // seeder); a shed sitting directly under the farm with no farm_id falls
    // back to its parent, which is that farm.
    const store = await storeOfFarm(shed.farm_id || shed.parent_location_id || batchFarmId);
    if (store) return store;

    throw new BadRequestException(
      `'${activityName ?? 'This line'}' cannot be posted — no silo is attached to this batch's shed and its farm has no store to draw from. Attach a silo to the shed, or create the farm's store location.`,
    );
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
