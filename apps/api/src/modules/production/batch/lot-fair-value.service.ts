import { BadRequestException, Injectable } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { batchScopeConditions, farmScope } from '../../../common/farm-scope';
import { periodOfKey } from '../../finance/bio-costing/bio-costing.engine';
import { BIO_DOCUMENT_TYPES as D } from '../../inventory/bio-asset-ledger/bio-asset-ledger.types';
import { BatchService } from './batch.service';
import { isCurrentBioLot } from './current-bio-lot';
import { lotFairValueLine, type LotFairValueLine } from './lot-fair-value.rules';

export interface LotFairValueResult extends LotFairValueLine {
  batch_id: string;
  batch_no: string;
  item_code: string | null;
  head: number;
  posted: boolean;
  message: string | null;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * The monthly fair value of the weaner and grower lots (BBP-2 S.NO.6: cost to week 17, fair value from week 18, per batch). For each eligible lot it reads the lot's item's
 * Fair Value Rates (the central calendar the user edits), prices the head the lot holds, and revalues the lot through the batch's own fair value posting, so the journal,
 * the ledger row and the carrying value agree. One revaluation per lot and period: a lot already revalued in the period is skipped.
 */
@Injectable()
export class LotFairValueService {
  constructor(
    private readonly cls: ClsService,
    private readonly batches: BatchService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const db = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('Tenant database connection context not established.');
    return db;
  }

  /** What each eligible lot would be revalued by for the month (changes nothing). */
  async preview(dto: { period_key: string; batch_id?: string }, tenantId: string): Promise<{ period: string; lines: LotFairValueResult[] }> {
    return this.run(dto, false, tenantId);
  }

  /** Revalues every eligible lot for the month, one posting each. A lot that cannot be valued is reported with its reason and does not stop the others. */
  async post(dto: { period_key: string; batch_id?: string }, tenantId: string, user?: { userId?: string }): Promise<{ period: string; lines: LotFairValueResult[] }> {
    return this.run(dto, true, tenantId, user);
  }

  private async run(dto: { period_key: string; batch_id?: string }, post: boolean, tenantId: string, user?: { userId?: string }) {
    const period = periodOfKey('MONTHLY', dto.period_key);
    if (!period) throw new BadRequestException(`'${dto.period_key}' is not a month (use YYYY-MM).`);
    if (post && period.end > today()) throw new BadRequestException(`Period ${period.key} has not ended yet.`);

    const lots = await this.db
      .select({ batch: schema.batchHeader, state: schema.batchBioAssetState })
      .from(schema.batchHeader)
      .innerJoin(schema.batchBioAssetState, eq(schema.batchBioAssetState.batch_id, schema.batchHeader.batch_id))
      .where(
        and(
          eq(schema.batchHeader.tenant_id, tenantId),
          eq(schema.batchHeader.status, 'ACTIVE'),
          eq(schema.batchHeader.costing_method, 'BIO_ASSET'),
          eq(schema.batchHeader.tracking_mode, 'BATCH_WISE'),
          isNull(schema.batchHeader.deleted_at),
          ...(dto.batch_id ? [eq(schema.batchHeader.batch_id, dto.batch_id)] : []),
          ...batchScopeConditions(farmScope(this.cls)),
        ),
      )
      .orderBy(asc(schema.batchHeader.batch_no));
    if (dto.batch_id && !lots.length) throw new BadRequestException('That batch is not an active head-count bio-asset batch in this workspace.');

    const lines: LotFairValueResult[] = [];
    for (const { batch, state } of lots) {
      if (!isCurrentBioLot({ is_litter_lot: batch.is_litter_lot, tracking_mode: batch.tracking_mode, current_stage_code: batch.current_stage_code })) continue;
      const [input] = await this.db.select({ item_id: schema.batchInputLine.item_id }).from(schema.batchInputLine).where(eq(schema.batchInputLine.batch_id, batch.batch_id)).limit(1);
      const [item] = input ? await this.db.select().from(schema.itemMaster).where(eq(schema.itemMaster.item_id, input.item_id)).limit(1) : [];
      const rates = item
        ? (await this.db.select().from(schema.itemFairValueRate).where(eq(schema.itemFairValueRate.item_id, item.item_id))).map((r) => ({
            farm_id: r.farm_id, age_week_from: r.age_week_from, effective_from: String(r.effective_from).slice(0, 10),
            expected_weight_kg: Number(r.expected_weight_kg), price_per_kg: Number(r.price_per_kg), costs_to_sell_pct: r.costs_to_sell_pct == null ? null : Number(r.costs_to_sell_pct),
          }))
        : [];
      const [done] = await this.db
        .select({ n: sql<string>`COUNT(*)` })
        .from(schema.bioAssetLedger)
        .where(and(eq(schema.bioAssetLedger.batch_id, batch.batch_id), eq(schema.bioAssetLedger.document_type, D.BATCH_FAIR_VALUE), sql`${schema.bioAssetLedger.posting_date} BETWEEN ${period.start} AND ${period.end}`));
      const head = Number(state.current_quantity) || 0;
      const line = lotFairValueLine({
        item_method: item?.bio_costing_method ?? null,
        start_age_weeks: Number(item?.bio_start_age_weeks ?? 0),
        start_age_days: item?.bio_start_age_days ?? 0,
        start_date: String(batch.start_date).slice(0, 10),
        farm_id: batch.farm_id ?? null,
        head,
        carrying_value: Number(state.nca_book_value) || 0,
        period,
        rates,
        already_run: Number(done?.n ?? 0) > 0,
      });
      const result: LotFairValueResult = { ...line, batch_id: batch.batch_id, batch_no: batch.batch_no, item_code: item?.item_code ?? null, head, posted: false, message: null };
      if (post && line.status === 'ADJUST') {
        try {
          await this.batches.recordFairValue(batch.batch_id, { posting_date: period.end, fair_value_per_unit: line.fair_value_per_head! }, tenantId, user);
          result.posted = true;
        } catch (error) {
          result.message = error instanceof Error ? error.message : String(error);
        }
      }
      lines.push(result);
    }
    return { period: period.key, lines };
  }
}
