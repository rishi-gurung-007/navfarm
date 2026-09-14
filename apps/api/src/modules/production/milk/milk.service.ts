import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, isNull, gte, lte, desc, sql, SQL } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { RecordMilkDto, QueryMilkDto } from './dto/milk.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { batchReferenceScopeConditions, batchScopeConditions, farmScope } from '../../../common/farm-scope';

const toMysqlTimestamp = (date: Date = new Date()) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

/**
 * Daily milk production for a dairy herd.
 *
 * The Dairy console previously displayed a hardcoded day — 1,180 L morning,
 * 1,100 L evening, 4.15% fat, 80 cows — and its "save" posted a batch id that
 * was not a UUID and swallowed the resulting error, so the screen reported
 * success while storing nothing. Every one of those numbers now comes from,
 * and goes to, `milk_production_log`.
 */
@Injectable()
export class MilkService {
  constructor(
    private readonly cls: ClsService,
    private readonly auditService: AuditLogService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  async record(dto: RecordMilkDto, tenantId: string, userPayload?: { userId?: string }) {
    const [batch] = await this.db
      .select()
      .from(schema.batchHeader)
      .where(and(eq(schema.batchHeader.batch_id, dto.batch_id), eq(schema.batchHeader.tenant_id, tenantId), ...batchScopeConditions(farmScope(this.cls))))
      .limit(1);
    if (!batch) throw new NotFoundException('Batch not found.');
    if (dto.company_id !== batch.company_id) throw new BadRequestException('Milk record company must match the batch company.');
    if (dto.operational_area_id && dto.operational_area_id !== batch.operational_area_id) {
      throw new BadRequestException('Milk record operational area must match the batch operational area.');
    }
    if (batch.status !== 'ACTIVE') {
      throw new BadRequestException(`Milk can only be recorded against an ACTIVE batch (this one is ${batch.status}).`);
    }

    if (dto.animal_id) {
      const [animal] = await this.db
        .select({ animal_id: schema.animalRegister.animal_id })
        .from(schema.animalRegister)
        .where(and(eq(schema.animalRegister.animal_id, dto.animal_id), eq(schema.animalRegister.current_batch_id, dto.batch_id)))
        .limit(1);
      if (!animal) throw new BadRequestException('That animal is not a member of this batch.');
    }

    // An existing record for the same batch/date/session is updated rather than
    // duplicated — re-saving the morning milking is a correction, not a second
    // milking. The unique index backs this up if two requests race.
    const existing = await this.db
      .select({ log_id: schema.milkProductionLog.log_id })
      .from(schema.milkProductionLog)
      .where(
        and(
          eq(schema.milkProductionLog.batch_id, dto.batch_id),
          eq(schema.milkProductionLog.log_date, dto.log_date),
          eq(schema.milkProductionLog.session, dto.session),
          dto.animal_id ? eq(schema.milkProductionLog.animal_id, dto.animal_id) : isNull(schema.milkProductionLog.animal_id),
        )
      )
      .limit(1);

    const num = (v?: number | null) => (v === undefined || v === null ? null : String(v));
    const values = {
      quantity_litres: String(dto.quantity_litres),
      fat_pct: num(dto.fat_pct),
      snf_pct: num(dto.snf_pct),
      scc_count: dto.scc_count ?? null,
      bmc_temperature_c: num(dto.bmc_temperature_c),
      remarks: dto.remarks || null,
      recorded_by: userPayload?.userId || null,
    };

    let logId: string;
    if (existing.length) {
      logId = existing[0].log_id;
      await this.db.update(schema.milkProductionLog).set(values).where(eq(schema.milkProductionLog.log_id, logId));
    } else {
      logId = randomUUID();
      try {
        await this.db.insert(schema.milkProductionLog).values({
          log_id: logId,
          tenant_id: tenantId,
          company_id: batch.company_id,
          operational_area_id: batch.operational_area_id || null,
          batch_id: dto.batch_id,
          animal_id: dto.animal_id || null,
          log_date: dto.log_date,
          session: dto.session,
          ...values,
        });
      } catch (err: unknown) {
        if ((err as { code?: string })?.code === 'ER_DUP_ENTRY') {
          throw new ConflictException('A record for that batch, date and session already exists.');
        }
        throw err;
      }
    }

    await this.auditService.log({
      tenantId,
      companyId: batch.company_id,
      userId: userPayload?.userId,
      action: existing.length ? 'UPDATE' : 'CREATE',
      entityName: 'milk_production_log',
      entityId: logId,
      newValues: { log_date: dto.log_date, session: dto.session, quantity_litres: dto.quantity_litres },
    });

    return this.findOne(logId, tenantId);
  }

  async findOne(logId: string, tenantId: string) {
    const scope = farmScope(this.cls);
    const [row] = await this.db
      .select()
      .from(schema.milkProductionLog)
      .where(and(
        eq(schema.milkProductionLog.log_id, logId),
        eq(schema.milkProductionLog.tenant_id, tenantId),
        isNull(schema.milkProductionLog.deleted_at),
        ...batchReferenceScopeConditions(scope, schema.milkProductionLog.batch_id),
      ))
      .limit(1);
    if (!row) throw new NotFoundException('Milk record not found.');
    return row;
  }

  async findAll(query: QueryMilkDto, tenantId: string) {
    const conditions: SQL[] = [eq(schema.milkProductionLog.tenant_id, tenantId), isNull(schema.milkProductionLog.deleted_at)];
    conditions.push(...batchReferenceScopeConditions(farmScope(this.cls), schema.milkProductionLog.batch_id));
    if (query.company_id) conditions.push(eq(schema.milkProductionLog.company_id, query.company_id));
    if (query.batch_id) conditions.push(eq(schema.milkProductionLog.batch_id, query.batch_id));
    if (query.animal_id) conditions.push(eq(schema.milkProductionLog.animal_id, query.animal_id));
    if (query.operational_area_id) conditions.push(eq(schema.milkProductionLog.operational_area_id, query.operational_area_id));
    if (query.log_date) conditions.push(eq(schema.milkProductionLog.log_date, query.log_date));
    if (query.from_date) conditions.push(gte(schema.milkProductionLog.log_date, query.from_date));
    if (query.to_date) conditions.push(lte(schema.milkProductionLog.log_date, query.to_date));

    return this.db
      .select({
        log_id: schema.milkProductionLog.log_id,
        batch_id: schema.milkProductionLog.batch_id,
        batch_no: schema.batchHeader.batch_no,
        animal_id: schema.milkProductionLog.animal_id,
        animal_code: schema.animalRegister.animal_code,
        ear_tag: schema.animalRegister.ear_tag,
        log_date: schema.milkProductionLog.log_date,
        session: schema.milkProductionLog.session,
        quantity_litres: schema.milkProductionLog.quantity_litres,
        fat_pct: schema.milkProductionLog.fat_pct,
        snf_pct: schema.milkProductionLog.snf_pct,
        scc_count: schema.milkProductionLog.scc_count,
        bmc_temperature_c: schema.milkProductionLog.bmc_temperature_c,
        remarks: schema.milkProductionLog.remarks,
      })
      .from(schema.milkProductionLog)
      .leftJoin(schema.batchHeader, eq(schema.batchHeader.batch_id, schema.milkProductionLog.batch_id))
      .leftJoin(schema.animalRegister, eq(schema.animalRegister.animal_id, schema.milkProductionLog.animal_id))
      .where(and(...conditions))
      .orderBy(desc(schema.milkProductionLog.log_date), schema.milkProductionLog.session);
  }

  /**
   * Everything the Daily Operations screen shows for one day, computed rather
   * than assumed: the sessions actually recorded, the live milking head count
   * from `animal_register`, and yield per cow derived from the two.
   */
  async dailySummary(batchId: string, logDate: string, tenantId: string) {
    const [batch] = await this.db
      .select()
      .from(schema.batchHeader)
      .where(and(eq(schema.batchHeader.batch_id, batchId), eq(schema.batchHeader.tenant_id, tenantId), ...batchScopeConditions(farmScope(this.cls))))
      .limit(1);
    if (!batch) throw new NotFoundException('Batch not found.');

    const sessions = await this.db
      .select()
      .from(schema.milkProductionLog)
      .where(
        and(
          eq(schema.milkProductionLog.batch_id, batchId),
          eq(schema.milkProductionLog.log_date, logDate),
          isNull(schema.milkProductionLog.animal_id),
          isNull(schema.milkProductionLog.deleted_at),
        )
      );

    const [{ milking }] = await this.db
      .select({ milking: sql<number>`COUNT(*)` })
      .from(schema.animalRegister)
      .where(
        and(
          eq(schema.animalRegister.current_batch_id, batchId),
          eq(schema.animalRegister.is_active, true),
          sql`${schema.animalRegister.status} IN ('LACTATING','ACTIVE')`,
        )
      );

    const byName = Object.fromEntries(sessions.map((s) => [s.session, s]));
    const totalLitres = sessions.reduce((sum, s) => sum + Number(s.quantity_litres || 0), 0);
    const milkingCount = Number(milking) || 0;

    // Composition is reported from whichever session actually carries a test.
    const withQuality = sessions.find((s) => s.fat_pct !== null) || null;

    return {
      batch_id: batchId,
      batch_no: batch.batch_no,
      log_date: logDate,
      morning: byName.MORNING || null,
      evening: byName.EVENING || null,
      bulk: byName.BULK || null,
      total_litres: totalLitres,
      milking_head: milkingCount,
      avg_litres_per_cow: milkingCount > 0 ? Number((totalLitres / milkingCount).toFixed(2)) : 0,
      fat_pct: withQuality?.fat_pct ? Number(withQuality.fat_pct) : null,
      snf_pct: withQuality?.snf_pct ? Number(withQuality.snf_pct) : null,
      scc_count: withQuality?.scc_count ?? null,
      bmc_temperature_c: withQuality?.bmc_temperature_c ? Number(withQuality.bmc_temperature_c) : null,
      remarks: sessions.find((s) => s.remarks)?.remarks || null,
      recorded_sessions: sessions.length,
    };
  }

  /**
   * The day's real cost lines for a batch, grouped the way the Dairy screen
   * presents them. Derived from `batch_transaction` — the same rows the shared
   * Data Entry screen writes — so the cost-per-litre shown here is the actual
   * recorded cost, not a figure assembled from hardcoded feed prices.
   */
  async dailyCosts(batchId: string, logDate: string, tenantId: string) {
    const [batch] = await this.db
      .select({ batch_id: schema.batchHeader.batch_id })
      .from(schema.batchHeader)
      .where(and(eq(schema.batchHeader.batch_id, batchId), eq(schema.batchHeader.tenant_id, tenantId), ...batchScopeConditions(farmScope(this.cls))))
      .limit(1);
    if (!batch) throw new NotFoundException('Batch not found.');

    const rows = await this.db
      .select({
        transaction_id: schema.batchTransaction.transaction_id,
        transaction_type: schema.batchTransaction.transaction_type,
        item_id: schema.batchTransaction.item_id,
        item_code: schema.itemMaster.item_code,
        item_name: schema.itemMaster.item_name,
        item_type: schema.itemMaster.item_type,
        resource_id: schema.batchTransaction.resource_id,
        quantity: schema.batchTransaction.quantity,
        uom: schema.batchTransaction.uom,
        rate: schema.batchTransaction.rate,
        amount: schema.batchTransaction.amount,
        persons: schema.batchTransaction.persons,
        hours: schema.batchTransaction.hours,
        remarks: schema.batchTransaction.remarks,
      })
      .from(schema.batchTransaction)
      .leftJoin(schema.itemMaster, eq(schema.itemMaster.item_id, schema.batchTransaction.item_id))
      .where(
        and(
          eq(schema.batchTransaction.batch_id, batchId),
          eq(schema.batchTransaction.transaction_date, logDate),
        )
      );

    // `amount` is stored negative for cost rows (see batch.service.ts); the
    // screen wants magnitudes.
    const cost = (r: { amount: string | null }) => Math.abs(Number(r.amount) || 0);
    // `item_type` is the inventory class (RAW_MATERIAL / CONSUMABLE), not a
    // feed-vs-medicine distinction — every feed item is RAW_MATERIAL and every
    // medicine is CONSUMABLE. The convention that actually separates them in
    // this catalogue is the item code prefix (FEED-*, MED-*), with the item
    // name as a fallback for items that predate it.
    const label = (r: { item_code: string | null; item_name: string | null }) =>
      `${r.item_code || ''} ${r.item_name || ''}`.toUpperCase();
    const isFeed = (r: { item_code: string | null; item_name: string | null }) =>
      /(^|\s)FEED[-\s]|RATION|SILAGE|CONCENTRATE|MASH|TMR/.test(label(r));
    const isMedicine = (r: { item_code: string | null; item_name: string | null }) =>
      /(^|\s)MED[-\s]|VACCIN|INJECT|BOLUS|DEWORM|ANTIBIOT/.test(label(r));

    const consumption = rows.filter((r) => r.transaction_type === 'CONSUMPTION');
    const overhead = rows.filter((r) => r.transaction_type === 'OVERHEAD');
    const labour = overhead.filter((r) => r.resource_id);
    const utilities = overhead.filter((r) => !r.resource_id);

    return {
      batch_id: batchId,
      log_date: logDate,
      feed: { lines: consumption.filter(isFeed), total: consumption.filter(isFeed).reduce((s, r) => s + cost(r), 0) },
      medicine: { lines: consumption.filter(isMedicine), total: consumption.filter(isMedicine).reduce((s, r) => s + cost(r), 0) },
      other_consumption: {
        lines: consumption.filter((r) => !isFeed(r) && !isMedicine(r)),
        total: consumption.filter((r) => !isFeed(r) && !isMedicine(r)).reduce((s, r) => s + cost(r), 0),
      },
      labour: { lines: labour, total: labour.reduce((s, r) => s + cost(r), 0) },
      utilities: { lines: utilities, total: utilities.reduce((s, r) => s + cost(r), 0) },
      total_cost: rows.reduce((s, r) => s + cost(r), 0),
      recorded_lines: rows.length,
    };
  }

  async remove(logId: string, tenantId: string, userPayload?: { userId?: string }) {
    const row = await this.findOne(logId, tenantId);
    await this.db
      .update(schema.milkProductionLog)
      .set({ deleted_at: toMysqlTimestamp() })
      .where(eq(schema.milkProductionLog.log_id, logId));
    await this.auditService.log({
      tenantId,
      companyId: row.company_id,
      userId: userPayload?.userId,
      action: 'DELETE',
      entityName: 'milk_production_log',
      entityId: logId,
    });
    return { log_id: logId, deleted: true };
  }
}
