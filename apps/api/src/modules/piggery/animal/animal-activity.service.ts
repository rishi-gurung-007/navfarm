import { Injectable } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { AnimalService } from './animal.service';
import { ConsumptionRow, groupConsumption, Reading, summariseWeights } from './animal-activity';

const RECENT_CONSUMPTION = 20;

/**
 * What the animal card shows that comes from the work done on the animal, not from its register row: the
 * weights and condition scores recorded for it, what it has eaten and been dosed with, how it died, and — for a
 * boar — the semen collected from him. All of it is read from where it was posted (batch_daily_data,
 * batch_transaction, batch_mortality_detail, semen_batch); nothing here is written or kept separately, so the card
 * cannot disagree with the batch.
 */
@Injectable()
export class AnimalActivityService {
  constructor(
    private readonly cls: ClsService,
    private readonly animals: AnimalService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  async getActivity(animalId: string) {
    // Scope-checked: an animal outside the caller's farm/company is a 404, as everywhere else.
    const animal = await this.animals.findOne(animalId);

    const readings = await this.db
      .select({
        date: schema.batchDailyData.entry_date,
        value: schema.batchDailyData.entered_value,
        metric: schema.schedulerLine.kpi_metric,
      })
      .from(schema.batchDailyData)
      .innerJoin(schema.schedulerLine, eq(schema.batchDailyData.line_id, schema.schedulerLine.line_id))
      .where(
        and(
          eq(schema.batchDailyData.animal_id, animalId),
          eq(schema.batchDailyData.posted, true),
          isNotNull(schema.batchDailyData.entered_value),
          inArray(schema.schedulerLine.kpi_metric, ['BODY_WEIGHT', 'BCS_SCORE']),
        ),
      )
      .orderBy(asc(schema.batchDailyData.entry_date));
    const of = (metric: string): Reading[] =>
      readings.filter((r) => r.metric === metric).map((r) => ({ date: String(r.date).slice(0, 10), value: Number(r.value) }));
    const weights = of('BODY_WEIGHT');
    const scores = of('BCS_SCORE');

    const consumptionRows = await this.db
      .select({
        item_id: schema.batchTransaction.item_id,
        item_code: schema.itemMaster.item_code,
        item_name: schema.itemMaster.item_name,
        item_type: schema.itemMaster.item_type,
        uom: schema.batchTransaction.uom,
        quantity: schema.batchTransaction.quantity,
        amount: schema.batchTransaction.amount,
        date: schema.batchTransaction.transaction_date,
      })
      .from(schema.batchTransaction)
      .leftJoin(schema.itemMaster, eq(schema.batchTransaction.item_id, schema.itemMaster.item_id))
      .where(and(eq(schema.batchTransaction.animal_id, animalId), isNull(schema.batchTransaction.reversed_at), eq(schema.batchTransaction.transaction_type, 'CONSUMPTION')))
      .orderBy(desc(schema.batchTransaction.transaction_date));
    const consumption: ConsumptionRow[] = consumptionRows.map((r) => ({
      ...r,
      quantity: Number(r.quantity ?? 0),
      amount: Number(r.amount ?? 0),
      date: String(r.date).slice(0, 10),
    }));

    // How it died, from the posting itself: the pen, the cause and findings, and the reason chosen for the death.
    const [death] = await this.db
      .select({
        date: schema.batchTransaction.transaction_date,
        remarks: schema.batchTransaction.remarks,
        location_id: schema.batchMortalityDetail.location_id,
        cause_of_death: schema.batchMortalityDetail.cause_of_death,
        post_mortem_notes: schema.batchMortalityDetail.post_mortem_notes,
        disposal_method: schema.batchMortalityDetail.disposal_method,
        pen_name: schema.locationMaster.location_name,
      })
      .from(schema.batchTransaction)
      .leftJoin(schema.batchMortalityDetail, eq(schema.batchMortalityDetail.transaction_id, schema.batchTransaction.transaction_id))
      .leftJoin(schema.locationMaster, eq(schema.batchMortalityDetail.location_id, schema.locationMaster.location_id))
      .where(and(eq(schema.batchTransaction.animal_id, animalId), isNull(schema.batchTransaction.reversed_at), eq(schema.batchTransaction.transaction_type, 'MORTALITY')))
      .orderBy(desc(schema.batchTransaction.transaction_date))
      .limit(1);
    let mortality: Record<string, unknown> | null = null;
    if (death || animal.disposal_type === 'DIED') {
      const [reason] = animal.disposal_reason_id
        ? await this.db
            .select({ reason_code: schema.reasonMaster.reason_code, reason_name: schema.reasonMaster.reason_name })
            .from(schema.reasonMaster)
            .where(eq(schema.reasonMaster.reason_id, animal.disposal_reason_id))
            .limit(1)
        : [];
      mortality = {
        date: death ? String(death.date).slice(0, 10) : animal.disposal_date,
        reason_code: reason?.reason_code ?? null,
        reason_name: reason?.reason_name ?? null,
        cause_of_death: death?.cause_of_death ?? null,
        post_mortem_notes: death?.post_mortem_notes ?? null,
        disposal_method: death?.disposal_method ?? null,
        pen: death?.pen_name ?? null,
        remarks: death?.remarks ?? null,
      };
    }

    // A boar's output is semen: the lots collected from him, and how many doses are used and sold.
    const semenLots =
      animal.gender === 'M'
        ? await this.db
            .select({
              semen_batch_id: schema.semenBatch.semen_batch_id,
              collection_date: schema.semenBatch.collection_date,
              doses_collected: schema.semenBatch.doses_collected,
              doses_used_internal: schema.semenBatch.doses_used_internal,
              doses_sold: schema.semenBatch.doses_sold,
              unit_cost_per_dose: schema.semenBatch.unit_cost_per_dose,
              inventory_posted: schema.semenBatch.inventory_posted,
              lot_no: schema.semenBatch.lot_no,
              expiry_date: schema.semenBatch.expiry_date,
              qr_id: schema.semenBatch.qr_id,
              volume_ml: schema.semenBatch.volume_ml,
              motility_pct: schema.semenBatch.motility_pct,
              concentration_m_per_ml: schema.semenBatch.concentration_m_per_ml,
            })
            .from(schema.semenBatch)
            // A lot he was the primary boar of, or one he was pooled into (a subquery, so a lot is one row however many boars).
            .where(
              or(
                eq(schema.semenBatch.boar_animal_id, animalId),
                sql`${schema.semenBatch.semen_batch_id} IN (SELECT semen_batch_id FROM semen_batch_boar WHERE boar_animal_id = ${animalId})`,
              ),
            )
            .orderBy(desc(schema.semenBatch.collection_date))
        : [];
    // A pooled lot is the mix of several boars: name them, so his card says whose semen it is mixed with.
    const poolRows = semenLots.length
      ? await this.db
          .select({ semen_batch_id: schema.semenBatchBoar.semen_batch_id, code: schema.animalRegister.animal_code })
          .from(schema.semenBatchBoar)
          .innerJoin(schema.animalRegister, eq(schema.animalRegister.animal_id, schema.semenBatchBoar.boar_animal_id))
          .where(inArray(schema.semenBatchBoar.semen_batch_id, semenLots.map((l) => l.semen_batch_id)))
          .orderBy(schema.semenBatchBoar.sort_order)
      : [];
    const semenLotsOut = semenLots.map((l) => {
      const boars = poolRows.filter((p) => p.semen_batch_id === l.semen_batch_id).map((p) => p.code);
      return { ...l, pooled: boars.length > 0, pool_boars: boars };
    });

    return {
      weights,
      condition_scores: scores,
      ...summariseWeights(weights),
      latest_condition_score: scores.length ? scores[scores.length - 1].value : null,
      consumption: {
        by_item: groupConsumption(consumption),
        recent: consumption.slice(0, RECENT_CONSUMPTION),
      },
      mortality,
      semen_lots: semenLotsOut,
    };
  }
}
