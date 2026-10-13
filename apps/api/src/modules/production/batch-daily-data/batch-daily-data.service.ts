import { siloShedLinkEffectiveOn, todayIso } from '../../../common/silo-shed-links';
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
import { eq, and, inArray, or, sql, isNull, isNotNull, gt, lte, like, desc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import { ModuleRef } from '@nestjs/core';
import * as schema from '../../../core/database/schema';
import { CreateBatchDailyDataDto } from './dto/batch-daily-data.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { BatchService, type UserContext } from '../batch/batch.service';
import { BatchTransferService } from '../batch/batch-transfer.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { AnimalMovementLogService } from '../../piggery/animal-movement-log/animal-movement-log.service';
import { BreedingService } from '../../piggery/breeding/breeding.service';
import { SiloFeedService } from '../../inventory/silo-feed/silo-feed.service';
import { FeedAlertService } from '../../inventory/feed-alert/feed-alert.service';
import { withTenantTransaction } from '../../../common/tenant-transaction';
import { farmStoreOf } from '../../../common/farm-store';
import { classifyPostedRow } from '../batch/batch-day-reversal';
import { animalOutputEvent, outputEventForItem, parsePoolIds, type AnimalOutputEvent } from './animal-output-event';
import { assertPostingPeriodOpen } from '../../../common/period-close';
import { LifecycleKpiEvaluator } from '../lifecycle/lifecycle-kpi.evaluator';
import { bagReconciliationWarning } from './bag-reconciliation';
import { allocateAcrossLots, orderLots, parseLotList } from './lot-allocation';
import { allocateSharesToParts } from './consumption-split';
import { lotBalances } from '../../inventory/inventory-ledger/lot-balance';
import { masterScopeConditions } from '../../../common/master-data-scope';

const round = (n: number) => Math.round(n * 1e4) / 1e4;

const toMysqlTimestamp = (date: Date = new Date()) =>
  date.toISOString().slice(0, 19).replace('T', ' ');

/**
 * One death on a mortality entry, validated and with its reason resolved. A batch with registered animals names the
 * animal; a count-only batch has none to name, so each death carries only its weight and reason.
 */
export interface MortalityEntry {
  animal_id: string | null;
  dead_weight_kg: number;
  reason_id: string | null;
  reason_text: string | null;
  /** The reason as shown in the movement log: the master's name, or the typed text. */
  reason_label: string;
  /** The animal's notes before death, so the typed cause can be appended rather than replace them. */
  notes: string | null;
}

const TERMINAL_ANIMAL_STATUSES = "('DEAD','SOLD','CULLED','SLAUGHTERED')";

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
    // The breeding service is reached through the module reference, at the moment a farrowing or weaning is posted:
    // it depends on the batch services that depend on this one, and a constructor reference would close the cycle.
    private readonly moduleRef: ModuleRef,
    // POST Day consumption lowers the silo it drew from (Plan A Task 4), so
    // the farm's silo levels are re-checked afterwards (checkpoint 12).
    // Optional so a testing module that does not provide it still builds.
    @Optional() private readonly feedAlerts?: FeedAlertService,
    // Breed lifecycle KPI limits/tolerances, checked alongside the schedule-line limits above. Optional like feedAlerts.
    @Optional() private readonly lifecycleKpi?: LifecycleKpiEvaluator,
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
    // r32: POST Day is refused for a date inside a CLOSED Reporting Period.
    await assertPostingPeriodOpen(this.db, { tenantId, companyId: header.company_id, postingDate: dto.entry_date });
    // Decision 8: an output is any item the farm takes out of the batch, chosen when it is entered; the line's own item
    // is only the default. Every other kind of line posts the item it was set up with.
    if (dto.item_id && line.line_type !== 'OUTPUT') {
      throw new BadRequestException(`'${line.activity_name}' is not an output line — only an output takes an item chosen at entry.`);
    }
    // An output's lot is made when it posts, so only a line that draws stock is asked for one.
    if (line.line_type !== 'OUTPUT' && line.lot_required && !dto.lot_no && !dto.serial_no) {
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
        costing_method: schema.batchHeader.costing_method,
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
    let entryAnimal: typeof schema.animalRegister.$inferSelect | undefined;
    if (dto.animal_id) {
      const [animal] = await this.db
        .select()
        .from(schema.animalRegister)
        .where(eq(schema.animalRegister.animal_id, dto.animal_id))
        .limit(1);
      entryAnimal = animal;
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
        (existingRow.serial_no || null) === (dto.serial_no || null) &&
        (existingRow.item_id || null) === (dto.item_id || null) &&
        (existingRow.destination_batch_id || null) === (dto.destination_batch_id || null) &&
        [...parsePoolIds(existingRow.pool_animal_ids)].sort().join(',') === [...(dto.pool_animal_ids ?? [])].sort().join(',');
      if (unchanged) {
        return this.findForDate(batchId, dto.entry_date, tenantId);
      }
      // Reopening a day reverses what it posted and puts the entries back to drafts, so a posted entry that arrives
      // changed has an effect still standing. For the kinds a reopen leaves posted — a transfer, a recorded death,
      // a bio-asset batch's output and cost — posting it again would count it twice; say so rather than do it.
      // A farrowing or weaning posted from data entry has no batch transaction behind it — it is the litter's own record.
      if (batchRow?.tracking_mode === 'ANIMAL_WISE' && line.line_type === 'OUTPUT' && existingRow.posting_reference) {
        const [litter] = await this.db
          .select({ farrow_id: schema.farrowingRecord.farrow_id })
          .from(schema.farrowingRecord)
          .where(eq(schema.farrowingRecord.farrow_id, existingRow.posting_reference))
          .limit(1);
        if (litter) {
          throw new ConflictException(
            `'${line.activity_name}' is already posted and it recorded a farrowing or weaning, so it cannot be changed in place. The litter has its own record on the Breeding screen.`,
          );
        }
        const [collection] = await this.db
          .select({ id: schema.semenBatch.semen_batch_id })
          .from(schema.semenBatch)
          .where(eq(schema.semenBatch.semen_batch_id, existingRow.posting_reference))
          .limit(1);
        if (collection) {
          throw new ConflictException(
            `'${line.activity_name}' is already posted and it recorded a semen collection, so it cannot be changed in place. The lot has its own record on the Breeding screen.`,
          );
        }
      }
      const verdict = classifyPostedRow(
        { line_type: line.line_type, kpi_metric: line.kpi_metric, entered_value: existingRow.entered_value },
        batchRow?.costing_method,
      );
      if (batchRow?.tracking_mode === 'ANIMAL_WISE' && !verdict.reversible) {
        throw new ConflictException(
          `'${line.activity_name}' is already posted and ${verdict.reason}, so it cannot be changed in place.`,
        );
      }
    }

    // Whole-batch MORTALITY_COUNT on a batch with registered animals: the entry must name which animals died.
    // Checked before anything is written, draft or post, so a bad choice changes nothing.
    const mortality = await this.planMortality({ batchId, dto, line, header, existingRow, tenantId, entryAnimal });

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
          item_id: dto.item_id || null,
          destination_batch_id: dto.destination_batch_id || null,
          pool_animal_ids: dto.pool_animal_ids?.length ? JSON.stringify(dto.pool_animal_ids) : null,
          reason_id: dto.reason_id || null,
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
            item_id: dto.item_id || null,
            destination_batch_id: dto.destination_batch_id || null,
            pool_animal_ids: dto.pool_animal_ids?.length ? JSON.stringify(dto.pool_animal_ids) : null,
          reason_id: dto.reason_id || null,
            remarks: dto.remarks || null,
            updated_by: userPayload?.userId || null,
            updated_at: toMysqlTimestamp(),
          },
        });
      // The choice rides with the draft; POST Day re-submits the draft without it and reads it back from here.
      if (mortality?.supplied) {
        await this.storeMortalityAnimals({ tenantId, companyId: header.company_id, batchId, line, dto, entries: mortality.entries, posted: false, userId: userPayload?.userId });
      }
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
        // The line's own item, and only that. An OUTPUT line with no item used to take the first
        // item named like "Piglet" or typed LIVESTOCK, so a semen collection or a manure line could
        // be posted into stock as piglets. Lines are validated to carry an item when they are made;
        // one that still has none is fixed, not guessed.
        const resolvedItemId = (line.line_type === 'OUTPUT' && dto.item_id) || line.item_id;
        if (!resolvedItemId)
          throw line.line_type === 'OUTPUT'
            ? new BadRequestException(`Choose the item '${line.activity_name}' takes out of the batch.`)
            : new ConflictException(
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
        if (dto.item_id && (!item || item.tenant_id !== tenantId || item.is_active === false)) {
          throw new NotFoundException('The chosen output item was not found, or is no longer active.');
        }
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
              dto.entry_date,
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

        // A sow's piglet output is a farrowing — or the weaning of the litter she is nursing — not stock arriving: it is
        // recorded by the same posting the Breeding screen uses, so the litter, its piglet lot and the sow's parity
        // are written once whichever screen it was entered on. Data entry carries the live-born count; stillborn,
        // mummified and fostering are recorded on the Breeding screen.
        const litter = await this.animalOutputEvent(line, header, dto, batchRow, item);
        if (litter) {
          const breeding = this.moduleRef.get(BreedingService, { strict: false });
          // The boar's motility read the same day (a SEMEN_MOTILITY line) goes on the lot (G8). The day's outputs post
          // after its readings, so a reading entered with the collection is already here.
          const motility =
            litter.kind === 'SEMEN' ? await this.sameDayReading(batchId, dto.animal_id!, dto.entry_date, 'SEMEN_MOTILITY') : null;
          if (dto.pool_animal_ids?.length && litter.kind !== 'SEMEN') {
            throw new BadRequestException('Only a boar\'s semen collection can be pooled with other boars.');
          }
          if (litter.kind === 'SEMEN' && dto.pool_animal_ids?.length) {
            await this.assertPoolBoarsFree(line.line_id, dto.entry_date, dto.animal_id!, dto.pool_animal_ids);
          }
          const result: any =
            litter.kind === 'SEMEN'
              ? await breeding.recordSemenCollection(
                  {
                    boar_animal_id: dto.animal_id!,
                    collection_date: dto.entry_date,
                    doses_collected: dto.entered_value,
                    // Any item the farm chose for semen: the line's.
                    output_item_id: resolvedItemId,
                    ...(dto.pool_animal_ids?.length ? { pool_boar_animal_ids: dto.pool_animal_ids } : {}),
                    ...(motility != null ? { motility_pct: motility } : {}),
                    notes: dto.remarks,
                  } as any,
                  tenantId,
                  userPayload,
                )
              : litter.kind === 'FARROWING'
              ? await breeding.recordFarrowing(
                  {
                    sow_animal_id: dto.animal_id!,
                    farrowing_date: dto.entry_date,
                    piglets_born_live: dto.entered_value,
                    piglet_item_id: resolvedItemId,
                    notes: dto.remarks,
                  } as any,
                  tenantId,
                  userPayload,
                )
              : await breeding.recordWeaning(
                  litter.farrow_id,
                  {
                    weaning_date: dto.entry_date,
                    piglets_weaned: dto.entered_value,
                    // Where the weaned piglets go, when the entry names a batch; else they stay in their lot.
                    move_to_batch_id: dto.destination_batch_id,
                  } as any,
                  tenantId,
                  userPayload,
                );
          posted = true;
          postingReference = result.farrow_id ?? result.semen_batch_id;
          dailyRemarks = [dto.remarks, result.message].filter(Boolean).join(' — ').slice(0, 500);
          break;
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
          if (
            line.kpi_metric === 'MORTALITY_COUNT' &&
            dto.animal_id &&
            dto.entered_value > 1
          ) {
            throw new BadRequestException(
              'One animal can die only once — enter 0 or 1 for it.',
            );
          }
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
              .select({ entered_value: schema.batchDailyData.entered_value, posted: schema.batchDailyData.posted })
              .from(schema.batchDailyData)
              // A draft is only what the user typed so far: only a posted row is a death already recorded. Counting
              // the draft made the post see no change (1 - 1) and record no death at all.
              .where(and(existingWhere, eq(schema.batchDailyData.posted, true)))
              .limit(1);
            // A draft row holds the value typed but nothing has happened yet: counting it here made the
            // draft-then-post flow see a delta of zero, so no death was ever recorded.
            const previousEntered =
              existing?.entered_value != null && existing.posted
                ? Number(existing.entered_value)
                : 0;
            const delta = dto.entered_value - previousEntered;
            newCount = Math.max(0, Number(header.animal_count) - delta);

            // A reported death is a MORTALITY posting, not just a count: the batch
            // transaction, closing quantity and cost write-off, and — for a named
            // animal — the register flip and movement log, all come from
            // addTransaction so every entry point records a death the same way.
            // This line keeps the stage headcount itself (below), so the shared
            // path is told not to touch it. Only a net increase in deaths posts;
            // a downward correction has no unambiguous animal to revive, so it
            // corrects animal_count alone. A recorded death is final: there is
            // no reversal (removed 13 Oct 2026, docs/decisions.md).
            const deathsToRecord = Math.round(delta);
            if (deathsToRecord > 0) {
              // Each death posts through addTransaction (feat/system-schedulers' accounting: the batch transaction,
              // closing quantity, cost write-off and, for a named animal, the register flip, movement log and
              // bio-asset write-off), carrying the dead weight and reason entered for it (Rishi, 12-13 Oct). A
              // count-only batch's deaths name no animal; this line keeps that stage's headcount itself (below).
              const deaths = mortality?.entries.length
                ? mortality.entries
                : [{ animal_id: dto.animal_id ?? null, dead_weight_kg: null as number | null, reason_id: null, reason_text: null, notes: null }];
              const quantityEach = mortality?.entries.length ? 1 : (dto.animal_id ? 1 : deathsToRecord);
              for (const e of deaths) {
                await this.batchService.addTransaction(
                  batchId,
                  {
                    transaction_date: dto.entry_date,
                    transaction_type: 'MORTALITY',
                    quantity: quantityEach,
                    uom: 'HEAD',
                    animal_id: e.animal_id ?? undefined,
                    ...(e.reason_id || e.reason_text
                      ? { mortality_detail: { ...(e.reason_id ? { reason_id: e.reason_id } : {}), ...(e.reason_text ? { cause_of_death: e.reason_text } : {}) } }
                      : {}),
                    remarks: e.dead_weight_kg != null
                      ? `${line.activity_name} — scheduled entry. Dead weight ${e.dead_weight_kg} kg`
                      : dto.remarks || `${line.activity_name} — scheduled entry`,
                    // A named animal is counted by the register (the batch recounts its stages);
                    // a head count keeps this line's own header.
                    skip_scheduler_count: !dto.animal_id,
                  } as any,
                  tenantId,
                  userPayload,
                );
                // A typed cause has no Reason Master row to point at, so it stays on the animal's own notes too.
                if (e.animal_id && e.reason_text) {
                  await this.db
                    .update(schema.animalRegister)
                    .set({ notes: [e.notes, `Cause of death: ${e.reason_text}`].filter(Boolean).join('\n') })
                    .where(eq(schema.animalRegister.animal_id, e.animal_id));
                }
              }
            }
            // Stored whether or not animals were named: a count-only batch still keeps each death's weight and reason.
            if (mortality?.entries.length) {
              await this.storeMortalityAnimals({ tenantId, companyId: header.company_id, batchId, line, dto, entries: mortality.entries, posted: true, userId: userPayload?.userId });
            }
          }
          // Animal-wise mortality is the register's to count (above); writing a number derived
          // from the header's own count here would put back whatever drift it carried.
          if (!(line.kpi_metric === 'MORTALITY_COUNT' && dto.animal_id)) {
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
        // An animal-wise batch names the exact animal on every entry (postEntry refuses an entry
        // without one), so that animal is the whole transfer — nobody is picked on the farmer's
        // behalf. A batch-wise batch holds no registered animals at all (a Count Only batch cannot),
        // so there is nobody to pick: the line moves a number of head instead. The old
        // oldest-registered-first guess could only ever run against a batch with no animals in it.
        let transferResult;
        if (dto.animal_id) {
          transferResult = await this.batchTransferService.create(
            {
              company_id: header.company_id,
              to_batch_id: dto.destination_batch_id,
              transfer_date: dto.entry_date,
              transfer_type: 'PARTIAL',
              animal_ids: [dto.animal_id],
              reason: line.activity_name,
              remarks: dto.remarks,
              auto_triggers_stage: line.auto_triggers_stage,
            } as any,
            tenantId,
            batchId,
            userPayload,
          );
        } else {
          const head = dto.entered_value ?? (line.standard_qty != null ? Number(line.standard_qty) : null);
          if (head == null || !(head > 0)) {
            throw new BadRequestException(
              "Enter how many head to move (or set the line's standard quantity).",
            );
          }
          transferResult = await this.batchTransferService.create(
            {
              company_id: header.company_id,
              to_batch_id: dto.destination_batch_id,
              transfer_date: dto.entry_date,
              transfer_type: 'PARTIAL',
              quantity: head,
              reason: line.activity_name,
              remarks: dto.remarks,
            } as any,
            tenantId,
            batchId,
            userPayload,
          );
        }
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

    // The stage's lifecycle KPIs (limits / tolerance) are checked in addition to the schedule-line limit above.
    // evaluateSafely never throws, so a failure here cannot undo or block the entry that was just saved.
    if (this.lifecycleKpi && line.kpi_metric && dto.entered_value != null) {
      await this.lifecycleKpi.evaluateSafely(batchId, tenantId, dto.entry_date, [line.kpi_metric]);
    }

    // CONSUMPTION re-checks the silo levels in postConsumptionGroup. Of the lines that reach here only OUTPUT
    // moves item stock; the rest (overhead, resources, animal transfers) leave every silo where it was. This
    // method opens no transaction of its own, so each write above has committed by here; the evaluation itself
    // never throws (Ruling M6).
    if (!opts.deferFeedAlerts && line.line_type === 'OUTPUT') {
      await this.reevaluateFeedLevels(batchRow?.farm_id, tenantId);
    }

    return this.findForDate(batchId, dto.entry_date, tenantId);
  }

  /**
   * A boar pooled into a lot gives his semen to that lot: he cannot also have a collection of his own entered on the same
   * line for the same day, or his doses would be counted twice.
   */
  private async assertPoolBoarsFree(lineId: string, entryDate: string, primaryId: string, poolIds: string[]) {
    const others = [...new Set(poolIds)].filter((id) => id !== primaryId);
    if (!others.length) return;
    const own = await this.db
      .select({ animal_id: schema.batchDailyData.animal_id, code: schema.animalRegister.animal_code })
      .from(schema.batchDailyData)
      .innerJoin(schema.animalRegister, eq(schema.animalRegister.animal_id, schema.batchDailyData.animal_id))
      .where(
        and(
          eq(schema.batchDailyData.line_id, lineId),
          eq(schema.batchDailyData.entry_date, entryDate),
          inArray(schema.batchDailyData.animal_id, others),
          isNotNull(schema.batchDailyData.entered_value),
        ),
      );
    if (own.length) {
      throw new ConflictException(
        `${own.map((o) => o.code).join(', ')} already ${own.length === 1 ? 'has' : 'have'} a collection of their own on this line for ${entryDate}. Clear it, or leave ${own.length === 1 ? 'him' : 'them'} out of the pool, so the doses are not counted twice.`,
      );
    }
  }

  /**
   * Whether an OUTPUT line recorded against an animal is a breeding event — a semen collection, a farrowing or a
   * weaning (see animal-output-event.ts, which the data-entry screen asks too). Anything else is ordinary output.
   */
  private async animalOutputEvent(
    line: typeof schema.schedulerLine.$inferSelect,
    header: typeof schema.schedulerHeader.$inferSelect,
    dto: CreateBatchDailyDataDto,
    batchRow: { tracking_mode?: string | null } | undefined,
    item: typeof schema.itemMaster.$inferSelect | undefined,
  ): Promise<AnimalOutputEvent | null> {
    if (line.line_type !== 'OUTPUT' || batchRow?.tracking_mode !== 'ANIMAL_WISE' || !dto.animal_id) return null;
    return outputEventForItem(await animalOutputEvent(this.db, dto.animal_id, header.stage_id ?? null), item);
  }

  /** An animal's reading of one KPI on a day, from its data entry (posted or still a draft). */
  private async sameDayReading(batchId: string, animalId: string, date: string, metric: string): Promise<number | null> {
    const [row] = await this.db
      .select({ value: schema.batchDailyData.entered_value })
      .from(schema.batchDailyData)
      .innerJoin(schema.schedulerLine, eq(schema.schedulerLine.line_id, schema.batchDailyData.line_id))
      .where(
        and(
          eq(schema.batchDailyData.batch_id, batchId),
          eq(schema.batchDailyData.animal_id, animalId),
          eq(schema.batchDailyData.entry_date, date),
          eq(schema.schedulerLine.kpi_metric, metric),
        ),
      )
      .limit(1);
    return row?.value != null ? Number(row.value) : null;
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
        item_id: dto.item_id || null,
        destination_batch_id: dto.destination_batch_id || null,
        pool_animal_ids: dto.pool_animal_ids?.length ? JSON.stringify(dto.pool_animal_ids) : null,
          reason_id: dto.reason_id || null,
        posted,
        posting_reference: postingReference,
        alert_triggered: alertTriggered,
        alert_note: alertNote,
        remarks: remarks || null,
        empty_bags: dto.empty_bags ?? null,
        created_by: userPayload?.userId || null,
        updated_by: userPayload?.userId || null,
      })
      .onDuplicateKeyUpdate({
        set: {
          entered_value: dto.entered_value?.toString() ?? null,
          entered_text: dto.entered_text || null,
          lot_no: dto.lot_no || null,
          serial_no: dto.serial_no || null,
          item_id: dto.item_id || null,
          destination_batch_id: dto.destination_batch_id || null,
          pool_animal_ids: dto.pool_animal_ids?.length ? JSON.stringify(dto.pool_animal_ids) : null,
          reason_id: dto.reason_id || null,
          posted,
          posting_reference: postingReference,
          alert_triggered: alertTriggered,
          alert_note: alertNote,
          remarks: remarks || null,
          empty_bags: dto.empty_bags ?? null,
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
        ? await this.splitSiloShortfall(first.sourceWarehouseId, resolvedItemId, total, first.farmId, header.company_id, tenantId, dto.entry_date)
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

    // Checkpoint 28: bags counted vs the quantity posted. A mismatch is flagged on the entries and logged, never refused.
    const bagWarning = await this.reconcileEmptyBags(group, total);

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
        alertTriggered: bagWarning !== null,
        alertNote: bagWarning,
        remarks: notes.length ? `${p.dto.remarks ? `${p.dto.remarks} — ` : ''}${notes.join('; ')}`.slice(0, 500) : p.dto.remarks,
      });
    }
    if (group.some((p) => !p.deferFeedAlerts)) await this.reevaluateFeedLevels(first.farmId, tenantId);
  }

  /**
   * Checkpoint 28: reconciles the empty bags counted across a consumption group
   * with the quantity just posted. Returns the warning (and logs it as a
   * BAG_RECONCILIATION alert) or null. No count entered means nothing to check.
   */
  private async reconcileEmptyBags(group: PendingConsumption[], consumedKg: number): Promise<string | null> {
    const counted = group.filter((p) => p.dto.empty_bags != null);
    if (counted.length === 0) return null;
    // Flag only, never block: a failure reading the settings or logging the alert must not fail the posting.
    try {
      const emptyBags = counted.reduce((n, p) => n + Number(p.dto.empty_bags), 0);
      const first = group[0];
      const { header, tenantId, batchId, line } = first;
      const rows = await this.db
        .select({ farm_id: schema.feedPlanningSetting.farm_id, bag_size_kg: schema.feedPlanningSetting.bag_size_kg, bag_tolerance_pct: schema.feedPlanningSetting.bag_tolerance_pct })
        .from(schema.feedPlanningSetting)
        .where(and(
          eq(schema.feedPlanningSetting.tenant_id, tenantId),
          eq(schema.feedPlanningSetting.company_id, header.company_id),
          eq(schema.feedPlanningSetting.is_active, true),
        ));
      const company = rows.find((r) => r.farm_id === null);
      const farm = first.farmId ? rows.find((r) => r.farm_id === first.farmId) : undefined;
      const bagSizeKg = Number(farm?.bag_size_kg ?? company?.bag_size_kg ?? 50);
      const tolerance = company?.bag_tolerance_pct;
      const warning = bagReconciliationWarning({ emptyBags, bagSizeKg, consumedKg, tolerancePct: tolerance == null ? null : Number(tolerance) });
      if (!warning) return null;
      await this.db.insert(schema.notificationAlertLog).values({
        alert_id: randomUUID(),
        tenant_id: tenantId,
        company_id: header.company_id,
        lob_id: header.lob_id,
        batch_id: batchId,
        line_id: line.line_id,
        alert_type: 'BAG_RECONCILIATION',
        severity: 'WARNING',
        title: 'Empty Bags vs Feed Consumed',
        message: warning,
        activity_name: line.activity_name,
        kpi_mode: 'VALUE',
        expected_value: String(emptyBags * bagSizeKg),
        actual_value: String(consumedKg),
      });
      return warning;
    } catch {
      return null;
    }
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
    /** The entry's date: only the silo links effective that day are drawn from. Defaults to today. */
    onDate: string = todayIso(),
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
          siloShedLinkEffectiveOn(onDate),
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
  private storeOfFarm(farmId: string | null): Promise<string | null> {
    return farmStoreOf(this.db, farmId);
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
    postingDate?: string,
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
          // Stock received under a later posting date is not in the silo yet on the entry's date.
          ...(postingDate ? [lte(schema.inventoryLedger.posting_date, postingDate)] : []),
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

  /** Registered animals still alive in the batch at the stage the line belongs to - the ones that can have died. */
  private async aliveAnimals(batchId: string, stageId: string | null | undefined) {
    return this.db
      .select({
        animal_id: schema.animalRegister.animal_id,
        animal_code: schema.animalRegister.animal_code,
        rfid_tag: schema.animalRegister.rfid_tag,
        notes: schema.animalRegister.notes,
      })
      .from(schema.animalRegister)
      .where(
        and(
          eq(schema.animalRegister.current_batch_id, batchId),
          ...(stageId ? [eq(schema.animalRegister.current_stage_id, stageId)] : []),
          eq(schema.animalRegister.is_active, true),
          sql`${schema.animalRegister.status} NOT IN ('DEAD','SOLD','CULLED','SLAUGHTERED')`,
        ),
      )
      .orderBy(schema.animalRegister.animal_code);
  }

  /**
   * Which animals a whole-batch MORTALITY_COUNT entry kills (Rishi, 12 Oct). Null when the rule does not apply: any
   * other line, or an animal-wise entry (which already names its one animal).
   *
   * The deaths an entry adds are its count less what was already POSTED for the line and date (a draft row has
   * recorded nothing). Exactly that many animals must be named, capped at the registered animals still alive: a batch
   * registered in part cannot name animals it does not have, and one with none registered keeps the count alone.
   * A correction upward therefore names only the extra animals; a correction downward adds no deaths, names none,
   * and leaves the animals already marked dead as they are (reviving one is an animal-register action).
   * A draft may omit the choice; posting may not. A draft's choice is stored, and POST Day - which re-submits the
   * draft row without it - reads it back.
   */
  private async planMortality(args: {
    batchId: string;
    dto: CreateBatchDailyDataDto;
    line: typeof schema.schedulerLine.$inferSelect;
    header: typeof schema.schedulerHeader.$inferSelect;
    existingRow: typeof schema.batchDailyData.$inferSelect | undefined;
    tenantId: string;
    entryAnimal?: { animal_code: string; notes: string | null; status?: string | null };
  }): Promise<{ supplied: boolean; entries: MortalityEntry[] } | null> {
    const { batchId, dto, line, header, existingRow, tenantId, entryAnimal } = args;
    const applies = line.line_type === 'DESCRIPTIVE' && line.kpi_metric === 'MORTALITY_COUNT';
    if (!applies) {
      if (dto.mortality_animals !== undefined) {
        throw new BadRequestException(
          'Animals that died are named only on the mortality count line.',
        );
      }
      return null;
    }
    if (dto.entered_value == null) {
      if (dto.mortality_animals?.length) throw new BadRequestException('Enter the mortality count before naming the animals.');
      return { supplied: false, entries: [] };
    }

    const previous = existingRow?.posted && existingRow.entered_value != null ? Number(existingRow.entered_value) : 0;
    const newDeaths = Math.max(0, Math.round(dto.entered_value - previous));
    // Animal-wise (Rishi, 13 Oct): the entry already names its animal; its death still needs a weight and a reason.
    if (dto.animal_id) {
      return this.planAnimalWiseMortality({ dto, line, newDeaths, tenantId, companyId: header.company_id, animal: entryAnimal });
    }

    const alive = await this.aliveAnimals(batchId, header.stage_id);
    // Registered: every death is a named animal, so more deaths than animals alive is refused, not capped.
    // Count-only: there is no animal to name, but each death still needs its dead weight and reason.
    const registered = alive.length > 0;
    if (registered && newDeaths > alive.length) {
      throw new BadRequestException(
        `This entry records ${newDeaths} death${newDeaths === 1 ? '' : 's'} but only ${alive.length} registered animal${alive.length === 1 ? ' is' : 's are'} alive in this batch at this stage.`,
      );
    }
    const required = newDeaths;

    let chosen = dto.mortality_animals as
      | Array<{ animal_id?: string | null; dead_weight_kg: number; reason_id?: string | null; reason_text?: string | null }>
      | undefined;
    const supplied = chosen !== undefined;
    if (!chosen && !dto.draft && required > 0) {
      const stored = await this.storedDraft(line.line_id, dto.entry_date, null);
      if (stored.length) {
        chosen = stored.map((r) => ({
          animal_id: r.animal_id,
          dead_weight_kg: Number(r.dead_weight_kg),
          reason_id: r.reason_id,
          reason_text: r.reason_text,
        }));
      }
    }
    if (!chosen) {
      if (!dto.draft && required > 0) {
        throw new BadRequestException(
          registered
            ? `Choose the ${required} animal${required === 1 ? '' : 's'} that died, with the dead weight and the reason for each.`
            : `Enter the dead weight and the reason for each of the ${required} dead animal${required === 1 ? '' : 's'}.`,
        );
      }
      return { supplied: false, entries: [] };
    }

    if (chosen.length !== required) {
      throw new BadRequestException(
        registered
          ? `This entry records ${required} death${required === 1 ? '' : 's'} - choose exactly ${required} animal${required === 1 ? '' : 's'} (${chosen.length} chosen).`
          : `This entry records ${required} death${required === 1 ? '' : 's'} - give a dead weight and reason for each (${chosen.length} given).`,
      );
    }
    const aliveById = new Map(alive.map((a) => [a.animal_id, a]));
    const seen = new Set<string>();
    const reasonById = await this.mortalityReasons(chosen, tenantId, header.company_id);

    const entries: MortalityEntry[] = [];
    for (const [i, c] of chosen.entries()) {
      let who: string;
      let animal: (typeof alive)[number] | undefined;
      if (registered) {
        animal = c.animal_id ? aliveById.get(c.animal_id) : undefined;
        if (!animal) {
          throw new BadRequestException(
            `Animal '${c.animal_id ?? ''}' is not alive in this batch at this line's stage, so it cannot be recorded as dead here.`,
          );
        }
        if (seen.has(animal.animal_id)) {
          throw new BadRequestException(`Animal '${animal.animal_code}' is chosen more than once.`);
        }
        seen.add(animal.animal_id);
        who = `animal '${animal.animal_code}'`;
      } else {
        if (c.animal_id) {
          throw new BadRequestException('This batch has no registered animals alive at this stage, so no animal can be named.');
        }
        who = `dead animal ${i + 1}`;
      }
      entries.push(this.mortalityEntry(c, who, reasonById, animal?.animal_id ?? null, animal?.notes ?? null));
    }
    return { supplied: supplied || entries.length > 0, entries };
  }

  /**
   * An animal-wise mortality entry: one animal, so it adds at most one death, and that death needs its dead weight
   * and reason like any other. The choice may omit animal_id (the entry's own) but may not name another animal.
   */
  private async planAnimalWiseMortality(args: {
    dto: CreateBatchDailyDataDto;
    line: { line_id: string };
    newDeaths: number;
    tenantId: string;
    companyId: string;
    animal?: { animal_code: string; notes: string | null; status?: string | null };
  }): Promise<{ supplied: boolean; entries: MortalityEntry[] }> {
    const { dto, line, newDeaths, tenantId, companyId, animal } = args;
    const animalId = dto.animal_id!;
    // An animal dies once (Rishi, 13 Oct): a second mortality entry for one already dead is refused.
    if (newDeaths > 0 && animal?.status === 'DEAD') {
      throw new BadRequestException(`Animal '${animal.animal_code}' is already recorded as dead.`);
    }
    if (newDeaths > 1) {
      throw new BadRequestException(`An animal-wise mortality entry records one animal - enter 1, not ${newDeaths}.`);
    }
    let chosen = dto.mortality_animals as
      | Array<{ animal_id?: string | null; dead_weight_kg: number; reason_id?: string | null; reason_text?: string | null }>
      | undefined;
    const supplied = chosen !== undefined;
    if (!chosen && !dto.draft && newDeaths > 0) {
      const stored = await this.storedDraft(line.line_id, dto.entry_date, animalId);
      if (stored.length) {
        chosen = stored.map((r) => ({ animal_id: r.animal_id, dead_weight_kg: Number(r.dead_weight_kg), reason_id: r.reason_id, reason_text: r.reason_text }));
      }
    }
    if (!chosen) {
      if (!dto.draft && newDeaths > 0) {
        throw new BadRequestException('Enter the dead weight and the reason for the animal that died.');
      }
      return { supplied: false, entries: [] };
    }
    if (chosen.length !== newDeaths) {
      throw new BadRequestException(
        newDeaths === 0
          ? 'This entry records no new death, so no dead weight or reason is taken.'
          : 'Give exactly one dead weight and reason for the animal that died.',
      );
    }
    if (chosen.some((c) => c.animal_id && c.animal_id !== animalId)) {
      throw new BadRequestException('An animal-wise entry records the death of its own animal only.');
    }
    const reasonById = await this.mortalityReasons(chosen, tenantId, companyId);
    const entries = chosen.map((c) => this.mortalityEntry(c, `animal '${animal?.animal_code ?? animalId}'`, reasonById, animalId, animal?.notes ?? null));
    return { supplied: supplied || entries.length > 0, entries };
  }

  /** The not-yet-posted choice saved with a draft; animal-wise drafts are kept per animal. */
  private storedDraft(lineId: string, date: string, animalId: string | null) {
    return this.db
      .select()
      .from(schema.batchMortalityAnimal)
      .where(
        and(
          eq(schema.batchMortalityAnimal.line_id, lineId),
          eq(schema.batchMortalityAnimal.entry_date, date),
          eq(schema.batchMortalityAnimal.posted, false),
          ...(animalId ? [eq(schema.batchMortalityAnimal.animal_id, animalId)] : []),
        ),
      );
  }

  private async mortalityReasons(chosen: Array<{ reason_id?: string | null }>, tenantId: string, companyId: string) {
    const reasonIds = [...new Set(chosen.map((c) => c.reason_id).filter((id): id is string => !!id))];
    const reasons = reasonIds.length
      ? await this.db
          .select()
          .from(schema.reasonMaster)
          .where(
            and(
              inArray(schema.reasonMaster.reason_id, reasonIds),
              eq(schema.reasonMaster.tenant_id, tenantId),
              eq(schema.reasonMaster.is_active, true),
              ...masterScopeConditions(this.cls, schema.reasonMaster, companyId),
            ),
          )
      : [];
    return new Map(reasons.map((r) => [r.reason_id, r]));
  }

  /** One death checked for its weight and reason (a mortality reason by id, or typed text - exactly one). */
  private mortalityEntry(
    c: { dead_weight_kg: number; reason_id?: string | null; reason_text?: string | null },
    who: string,
    reasonById: Map<string, typeof schema.reasonMaster.$inferSelect>,
    animalId: string | null,
    notes: string | null,
  ): MortalityEntry {
    const weight = Number(c.dead_weight_kg);
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new BadRequestException(`Enter the dead weight (kg, more than 0) for ${who}.`);
    }
    const text = c.reason_text?.trim() || null;
    if ((c.reason_id ? 1 : 0) + (text ? 1 : 0) !== 1) {
      throw new BadRequestException(
        `Give ${who} a reason from the Reason Master, or type one - not both, not neither.`,
      );
    }
    let label: string;
    if (c.reason_id) {
      const reason = reasonById.get(c.reason_id);
      if (!reason) {
        throw new BadRequestException(`Reason '${c.reason_id}' is not available in this workspace.`);
      }
      if (reason.category !== 'MORTALITY') {
        throw new BadRequestException(
          `Reason '${reason.reason_name}' is category ${reason.category}, not MORTALITY - a death needs a mortality reason.`,
        );
      }
      label = reason.reason_name;
    } else {
      label = text!;
    }
    return {
      animal_id: animalId,
      dead_weight_kg: Math.round(weight * 1000) / 1000,
      reason_id: c.reason_id ?? null,
      reason_text: text,
      reason_label: label,
      notes,
    };
  }

  /** Replaces the line's not-yet-posted choice for the date with this one (a draft), or records it as posted. */
  private async storeMortalityAnimals(args: {
    tenantId: string;
    companyId: string;
    batchId: string;
    line: { line_id: string };
    dto: CreateBatchDailyDataDto;
    entries: MortalityEntry[];
    posted: boolean;
    userId?: string;
  }) {
    const { tenantId, companyId, batchId, line, dto, entries, posted, userId } = args;
    // Animal-wise entries share the line and date across animals: replace only this animal's draft.
    await this.db
      .delete(schema.batchMortalityAnimal)
      .where(
        and(
          eq(schema.batchMortalityAnimal.line_id, line.line_id),
          eq(schema.batchMortalityAnimal.entry_date, dto.entry_date),
          eq(schema.batchMortalityAnimal.posted, false),
          ...(dto.animal_id ? [eq(schema.batchMortalityAnimal.animal_id, dto.animal_id)] : []),
        ),
      );
    if (!entries.length) return;
    await this.db.insert(schema.batchMortalityAnimal).values(
      entries.map((e) => ({
        detail_id: randomUUID(),
        tenant_id: tenantId,
        company_id: companyId,
        batch_id: batchId,
        line_id: line.line_id,
        entry_date: dto.entry_date,
        animal_id: e.animal_id,
        dead_weight_kg: e.dead_weight_kg.toString(),
        reason_id: e.reason_id,
        reason_text: e.reason_text,
        posted,
        created_by: userId || null,
      })),
    );
  }

  /**
   * What Data Entry needs to decide whether a mortality line asks for animals: the registered animals still alive
   * in the batch at the line's stage. Empty means the batch is count-only for this line.
   */
  async mortalityCandidates(batchId: string, lineId: string, date?: string) {
    await this.batchService.findOne(batchId);
    const [line] = await this.db.select().from(schema.schedulerLine).where(eq(schema.schedulerLine.line_id, lineId)).limit(1);
    if (!line) throw new NotFoundException(`Scheduler line '${lineId}' not found.`);
    const [header] = await this.db
      .select()
      .from(schema.schedulerHeader)
      .where(eq(schema.schedulerHeader.scheduler_id, line.scheduler_id))
      .limit(1);
    if (!header || header.batch_id !== batchId) {
      throw new BadRequestException(`Line '${lineId}' does not belong to batch '${batchId}'.`);
    }
    const alive = line.kpi_metric === 'MORTALITY_COUNT' ? await this.aliveAnimals(batchId, header.stage_id) : [];
    // The stage's animals already dead: Data Entry shows them greyed, never as a choice (Rishi, 13 Oct).
    const dead = line.kpi_metric === 'MORTALITY_COUNT' && header.stage_id
      ? await this.db
          .select({ animal_id: schema.animalRegister.animal_id, animal_code: schema.animalRegister.animal_code, disposal_date: schema.animalRegister.disposal_date })
          .from(schema.animalRegister)
          .where(
            and(
              eq(schema.animalRegister.current_batch_id, batchId),
              eq(schema.animalRegister.current_stage_id, header.stage_id),
              eq(schema.animalRegister.status, 'DEAD'),
            ),
          )
          .orderBy(schema.animalRegister.animal_code)
      : [];
    // What the date already has posted for the line: a correction names only the deaths it adds beyond that.
    const [posted] = date
      ? await this.db
          .select({ entered_value: schema.batchDailyData.entered_value })
          .from(schema.batchDailyData)
          .where(
            and(
              eq(schema.batchDailyData.line_id, lineId),
              eq(schema.batchDailyData.entry_date, date),
              isNull(schema.batchDailyData.animal_id),
              eq(schema.batchDailyData.posted, true),
            ),
          )
          .limit(1)
      : [];
    // A saved draft's choice, so the screen can show it again instead of asking for it twice.
    const draft = date
      ? await this.db
          .select()
          .from(schema.batchMortalityAnimal)
          .where(
            and(
              eq(schema.batchMortalityAnimal.line_id, lineId),
              eq(schema.batchMortalityAnimal.entry_date, date),
              eq(schema.batchMortalityAnimal.posted, false),
            ),
          )
      : [];
    return {
      line_id: lineId,
      draft_animals: draft.map((d) => ({
        animal_id: d.animal_id,
        dead_weight_kg: Number(d.dead_weight_kg),
        reason_id: d.reason_id,
        reason_text: d.reason_text,
      })),
      already_posted: posted?.entered_value != null ? Number(posted.entered_value) : 0,
      stage_id: header.stage_id ?? null,
      animals: alive.map((a) => ({ animal_id: a.animal_id, animal_code: a.animal_code, rfid_tag: a.rfid_tag })),
      dead_animals: dead.map((a) => ({ animal_id: a.animal_id, animal_code: a.animal_code, died_on: a.disposal_date ? String(a.disposal_date).slice(0, 10) : null })),
    };
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
