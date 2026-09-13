import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { CreateBatchDailyDataDto } from './dto/batch-daily-data.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { BatchService, type UserContext } from '../batch/batch.service';
import { BatchTransferService } from '../batch/batch-transfer.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';

const toMysqlTimestamp = (date: Date = new Date()) => date.toISOString().slice(0, 19).replace('T', ' ');

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
    private readonly batchService: BatchService,
    private readonly batchTransferService: BatchTransferService,
    private readonly glPostingService: GlPostingService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  async postEntry(batchId: string, dto: CreateBatchDailyDataDto, tenantId: string, userPayload?: UserContext) {
    const [line] = await this.db.select().from(schema.schedulerLine).where(eq(schema.schedulerLine.line_id, dto.line_id)).limit(1);
    if (!line) throw new NotFoundException(`Scheduler line '${dto.line_id}' not found.`);
    if (!line.is_active) throw new ConflictException('This line has been deactivated and no longer accepts entries.');

    const [header] = await this.db.select().from(schema.schedulerHeader).where(eq(schema.schedulerHeader.scheduler_id, line.scheduler_id)).limit(1);
    if (!header || header.batch_id !== batchId) {
      throw new BadRequestException(`Line '${dto.line_id}' does not belong to batch '${batchId}'.`);
    }
    if (line.lot_required && !dto.lot_no) {
      throw new BadRequestException(`'${line.activity_name}' requires a lot number.`);
    }

    const entryId = randomUUID();
    let posted = false;
    let postingReference: string | null = null;
    let alertTriggered = false;
    let alertNote: string | null = null;

    switch (line.line_type) {
      case 'CONSUMPTION':
      case 'OUTPUT': {
        if (!line.item_id) throw new ConflictException(`'${line.activity_name}' has no item configured — fix the line before posting entries against it.`);
        if (dto.entered_value == null) throw new BadRequestException('entered_value is required for this line.');
        const [item] = await this.db.select().from(schema.itemMaster).where(eq(schema.itemMaster.item_id, line.item_id)).limit(1);
        const updated = await this.batchService.addTransaction(batchId, {
          transaction_date: dto.entry_date,
          transaction_type: line.line_type,
          item_id: line.item_id,
          quantity: dto.entered_value,
          uom: item?.uom_primary || 'PCS',
          rate: dto.rate,
          remarks: dto.remarks || `${line.activity_name} — scheduled entry`,
        } as any, tenantId, userPayload);
        // No created_at in this projection to sort by — the newly-inserted row is
        // reliably last for a simple unordered SELECT against an append-only table.
        const matchingTx = (updated.transactions || [])
          .filter((t: any) => t.transaction_date === dto.entry_date && t.item_id === line.item_id && t.transaction_type === line.line_type);
        posted = true;
        postingReference = matchingTx[matchingTx.length - 1]?.transaction_id || null;
        break;
      }
      case 'DESCRIPTIVE': {
        if (dto.entered_value == null && !dto.entered_text) {
          throw new BadRequestException('entered_value or entered_text is required for this line.');
        }
        if (dto.entered_value != null) {
          const minVal = line.lower_alert_limit != null ? Number(line.lower_alert_limit) : -Infinity;
          const maxVal = line.upper_alert_limit != null ? Number(line.upper_alert_limit) : Infinity;
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
              severity: line.alert_severity === 'INFO' || line.alert_severity === 'CRITICAL' ? line.alert_severity : 'WARNING',
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
        if (dto.entered_value != null && (line.kpi_metric === 'HEAD_COUNT' || line.kpi_metric === 'MORTALITY_COUNT')) {
          let newCount: number;
          if (line.kpi_metric === 'HEAD_COUNT') {
            newCount = dto.entered_value;
          } else {
            const [existing] = await this.db.select({ entered_value: schema.batchDailyData.entered_value })
              .from(schema.batchDailyData)
              .where(and(eq(schema.batchDailyData.line_id, line.line_id), eq(schema.batchDailyData.entry_date, dto.entry_date)))
              .limit(1);
            const previousEntered = existing?.entered_value != null ? Number(existing.entered_value) : 0;
            const delta = dto.entered_value - previousEntered;
            newCount = Math.max(0, Number(header.animal_count) - delta);

            // Keep animal_register in step with the reported death count — without
            // this, a stage transition re-derives animal_count from animal_register's
            // own live count (createForStage()) and silently reverts the mortality
            // this line just recorded. Only handles a net *increase* in deaths
            // (delta > 0); a downward correction has no unambiguous animal to
            // "revive" so animal_count above is still corrected, just not the registry.
            const deathsToRecord = Math.round(delta);
            if (deathsToRecord > 0) {
              const dying = await this.db
                .select({ animal_id: schema.animalRegister.animal_id })
                .from(schema.animalRegister)
                .where(and(
                  eq(schema.animalRegister.current_batch_id, batchId),
                  eq(schema.animalRegister.is_active, true),
                  sql`${schema.animalRegister.status} NOT IN ('DEAD','SOLD','CULLED','SLAUGHTERED')`,
                ))
                .orderBy(schema.animalRegister.created_at)
                .limit(deathsToRecord);
              if (dying.length) {
                await this.db.update(schema.animalRegister)
                  .set({
                    is_active: false,
                    status: 'DEAD',
                    disposal_type: 'DIED',
                    disposal_date: dto.entry_date,
                    updated_by: userPayload?.userId || null,
                    updated_at: toMysqlTimestamp(),
                  })
                  .where(inArray(schema.animalRegister.animal_id, dying.map((a) => a.animal_id)));
              }
            }
          }
          await this.db.update(schema.schedulerHeader)
            .set({ animal_count: newCount.toString(), updated_at: toMysqlTimestamp() })
            .where(eq(schema.schedulerHeader.scheduler_id, header.scheduler_id));
        }
        break;
      }
      case 'OVERHEAD':
      case 'RESOURCE': {
        if (dto.entered_value == null) throw new BadRequestException('entered_value is required for this line.');
        let quantity = dto.entered_value;
        let rate = dto.rate ?? null;
        if (line.line_type === 'RESOURCE') {
          if (!line.resource_id) throw new ConflictException(`'${line.activity_name}' has no resource configured.`);
          if (rate == null) {
            const [resource] = await this.db.select().from(schema.resourceMaster).where(eq(schema.resourceMaster.resource_id, line.resource_id)).limit(1);
            rate = resource?.cost_rate != null ? Number(resource.cost_rate) : null;
          }
        } else if (rate == null) {
          // OVERHEAD lines are naturally entered as a single day's total cost —
          // quantity 1 x rate = that amount, rather than asking the farmer to
          // split a utility bill into a unit rate they don't track.
          rate = quantity;
          quantity = 1;
        }
        if (rate == null) throw new BadRequestException(`'${line.activity_name}' needs a rate to post — supply one or set it on the resource.`);
        const updated = await this.batchService.addTransaction(batchId, {
          transaction_date: dto.entry_date,
          transaction_type: 'OVERHEAD',
          resource_id: line.resource_id || undefined,
          quantity,
          rate,
          remarks: dto.remarks || `${line.activity_name} — scheduled entry`,
        } as any, tenantId, userPayload);
        const matchingTx = (updated.transactions || [])
          .filter((t: any) => t.transaction_date === dto.entry_date && t.transaction_type === 'OVERHEAD');
        posted = true;
        postingReference = matchingTx[matchingTx.length - 1]?.transaction_id || null;
        break;
      }
      case 'TRANSFER': {
        if (!dto.destination_batch_id) throw new BadRequestException("TRANSFER lines require destination_batch_id.");
        if (dto.entered_value == null && line.standard_qty == null) {
          throw new BadRequestException('entered_value (or the line\'s standard_qty) is required to know how many head to move.');
        }
        const headcount = Math.round(dto.entered_value ?? Number(line.standard_qty));
        // Auto-select the oldest still-in-this-batch animals up to the requested
        // headcount — the schedule line only says how many move, not which ones;
        // FIFO-by-registration is the same order the rest of the app already
        // assumes when it doesn't have a farmer's explicit pick.
        const candidates = await this.db
          .select({ animal_id: schema.animalRegister.animal_id })
          .from(schema.animalRegister)
          .where(and(eq(schema.animalRegister.current_batch_id, batchId), eq(schema.animalRegister.is_active, true)))
          .orderBy(schema.animalRegister.created_at)
          .limit(headcount);
        if (!candidates.length) {
          throw new ConflictException(`No animals currently in batch '${batchId}' to transfer.`);
        }
        const transferResult = await this.batchTransferService.create(
          {
            company_id: header.company_id,
            to_batch_id: dto.destination_batch_id,
            transfer_date: dto.entry_date,
            transfer_type: 'PARTIAL',
            animal_ids: candidates.map((c) => c.animal_id),
            reason: line.activity_name,
            remarks: dto.remarks,
            auto_triggers_stage: line.auto_triggers_stage,
          } as any,
          tenantId,
          batchId,
          userPayload,
        );
        posted = true;
        postingReference = (transferResult as any)?.transfer_id || dto.destination_batch_id;
        break;
      }
      default:
        throw new BadRequestException(`Unknown line_type '${line.line_type}'.`);
    }

    await this.db.insert(schema.batchDailyData).values({
      entry_id: entryId,
      tenant_id: tenantId,
      company_id: header.company_id,
      line_id: line.line_id,
      batch_id: batchId,
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
    }).onDuplicateKeyUpdate({
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
      newValues: { line_id: line.line_id, batch_id: batchId, entry_date: dto.entry_date },
    });

    return this.findForDate(batchId, dto.entry_date, tenantId);
  }

  async findForDate(batchId: string, entryDate: string, tenantId: string) {
    return this.db
      .select()
      .from(schema.batchDailyData)
      .where(and(eq(schema.batchDailyData.batch_id, batchId), eq(schema.batchDailyData.entry_date, entryDate), eq(schema.batchDailyData.tenant_id, tenantId)));
  }
}
