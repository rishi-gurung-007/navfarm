import { Injectable } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { AnimalService } from './animal.service';
import { amortisationEndDate, ConsumptionRow, groupConsumption, Reading, summariseWeights } from './animal-activity';
import { buildParityExpense, type ExpenseEvent, type ParityFacts } from './animal-parity-expense';
import { bioEventCondition } from '../../inventory/bio-asset-ledger/bio-asset-ledger.types';

const RECENT_CONSUMPTION = 20;
const today = () => new Date().toISOString().slice(0, 10);

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

  /**
   * The facts the animal card shows beside her register row, worked out from where they were recorded: her amortisation window from her
   * item's terms, the litter lot and colour code her gilt selection gave her, her birth weight (the litter's average from its farrowing —
   * piglets are not weighed one by one at birth) and her latest posted body weight. Out-of-production is her own column and is not here.
   */
  async cardFacts(animal: {
    animal_id: string;
    item_id: string;
    dob: string | null;
    entry_date: string;
    age_at_entry_weeks: number | null;
    source_batch_id: string | null;
    costing_start_date: string | null;
  }) {
    const [item] = await this.db
      .select({ bio_costing_method: schema.itemMaster.bio_costing_method, bio_useful_life_months: schema.itemMaster.bio_useful_life_months })
      .from(schema.itemMaster)
      .where(eq(schema.itemMaster.item_id, animal.item_id))
      .limit(1);

    const [gilt] = await this.db
      .select({ lot_no: schema.giltSelectionLine.lot_no, colour_code: schema.giltSelectionLine.colour_code, farrow_id: schema.giltSelectionLine.farrow_id })
      .from(schema.giltSelectionGilt)
      .innerJoin(schema.giltSelectionLine, eq(schema.giltSelectionLine.line_id, schema.giltSelectionGilt.line_id))
      .innerJoin(schema.giltSelection, eq(schema.giltSelection.selection_id, schema.giltSelectionGilt.selection_id))
      .where(and(eq(schema.giltSelectionGilt.animal_id, animal.animal_id), sql`${schema.giltSelection.status} <> 'CANCELLED'`))
      .orderBy(desc(schema.giltSelection.selection_date))
      .limit(1);

    // Her litter: the one her gilt selection names, else the litter lot she was born into (a piglet lot made at a farrowing).
    const litterWhere = gilt?.farrow_id
      ? eq(schema.farrowingRecord.farrow_id, gilt.farrow_id)
      : animal.source_batch_id
        ? eq(schema.farrowingRecord.piglet_batch_id, animal.source_batch_id)
        : null;
    const [litter] = litterWhere
      ? await this.db
          .select({ piglet_lot_no: schema.farrowingRecord.piglet_lot_no, avg_birth_weight_kg: schema.farrowingRecord.avg_birth_weight_kg })
          .from(schema.farrowingRecord)
          .where(litterWhere)
          .limit(1)
      : [];

    const weights = await this.db
      .select({ date: schema.batchDailyData.entry_date, value: schema.batchDailyData.entered_value })
      .from(schema.batchDailyData)
      .innerJoin(schema.schedulerLine, eq(schema.batchDailyData.line_id, schema.schedulerLine.line_id))
      .where(
        and(
          eq(schema.batchDailyData.animal_id, animal.animal_id),
          eq(schema.batchDailyData.posted, true),
          isNotNull(schema.batchDailyData.entered_value),
          eq(schema.schedulerLine.kpi_metric, 'BODY_WEIGHT'),
        ),
      )
      .orderBy(asc(schema.batchDailyData.entry_date));
    const { current_weight_kg, current_weight_date } = summariseWeights(
      weights.map((r) => ({ date: String(r.date).slice(0, 10), value: Number(r.value) })),
    );

    return {
      amortization_start_date: animal.costing_start_date ? String(animal.costing_start_date).slice(0, 10) : null,
      amortization_end_date: amortisationEndDate(
        { dob: animal.dob ? String(animal.dob).slice(0, 10) : null, entry_date: String(animal.entry_date).slice(0, 10), age_at_entry_weeks: animal.age_at_entry_weeks },
        item,
      ),
      lot_no: gilt?.lot_no ?? litter?.piglet_lot_no ?? null,
      colour_code: gilt?.colour_code ?? null,
      birth_weight_kg: litter?.avg_birth_weight_kg != null ? Number(litter.avg_birth_weight_kg) : null,
      current_weight_kg,
      current_weight_date,
    };
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
        // Where the body went: the death record's, else what the register keeps for every exit.
        disposal_method: death?.disposal_method ?? animal.disposal_destination ?? null,
        weight_kg: animal.exit_weight_kg != null ? Number(animal.exit_weight_kg) : null,
        book_value_at_death: animal.book_value_at_death != null ? Number(animal.book_value_at_death) : null,
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

  /**
   * A sow's cost, parity by parity (see animal-parity-expense.ts for the windows). Read from where the cost was posted: her feed, medicine, semen and
   * overhead from the batch's transactions against her (reversed ones left out), her amortisation from her own bio-asset ledger, the parities from
   * her breeding and farrowing records. Nothing is written; what the batch and the ledger say is what shows.
   */
  async getParityExpense(animalId: string) {
    const animal = await this.animals.findOne(animalId);

    const spent = await this.db
      .select({
        date: schema.batchTransaction.transaction_date,
        type: schema.batchTransaction.transaction_type,
        amount: schema.batchTransaction.amount,
        item_type: schema.itemMaster.item_type,
      })
      .from(schema.batchTransaction)
      .leftJoin(schema.itemMaster, eq(schema.batchTransaction.item_id, schema.itemMaster.item_id))
      .where(and(
        eq(schema.batchTransaction.animal_id, animalId),
        isNull(schema.batchTransaction.reversed_at),
        inArray(schema.batchTransaction.transaction_type, ['CONSUMPTION', 'OVERHEAD']),
      ));
    const events: ExpenseEvent[] = spent.map((r) => ({
      date: String(r.date).slice(0, 10),
      kind: r.type === 'OVERHEAD' ? 'OVERHEAD' : r.item_type === 'FEED' ? 'FEED' : 'OTHER_CONSUMPTION',
      // A consumption or overhead is stored as a negative amount; the table shows what it cost.
      amount: Math.abs(Number(r.amount ?? 0)),
    }));

    // Amortisation is a charge on her ledger (negative) and a reversal puts it back (positive), so the net charge is the sum, negated.
    const charged = await this.db
      .select({ date: schema.bioAssetLedger.posting_date, amount: sql<string>`SUM(${schema.bioAssetLedger.cost_amount})` })
      .from(schema.bioAssetLedger)
      .where(and(eq(schema.bioAssetLedger.animal_id, animalId), bioEventCondition(schema.bioAssetLedger, 'AMORTIZATION')))
      .groupBy(schema.bioAssetLedger.posting_date);
    for (const c of charged) {
      const net = -Number(c.amount ?? 0);
      if (net) events.push({ date: String(c.date).slice(0, 10), kind: 'AMORTISATION', amount: net });
    }

    // A parity is a service that was confirmed or has farrowed; one that failed to take is not.
    const services = await this.db
      .select({
        breeding_parity: schema.breedingRecord.parity_number,
        mating_date: schema.breedingRecord.mating_date,
        confirmed: schema.breedingRecord.pregnancy_confirmed,
        farrowing_date: schema.farrowingRecord.farrowing_date,
        farrowing_parity: schema.farrowingRecord.parity_number,
        weaning_date: schema.farrowingRecord.weaning_date,
        piglets_born_live: schema.farrowingRecord.piglets_born_live,
        piglets_weaned: schema.farrowingRecord.piglets_weaned,
      })
      .from(schema.breedingRecord)
      .leftJoin(schema.farrowingRecord, eq(schema.farrowingRecord.breeding_id, schema.breedingRecord.breeding_id))
      .where(eq(schema.breedingRecord.sow_animal_id, animalId))
      .orderBy(asc(schema.breedingRecord.mating_date));
    const parities: ParityFacts[] = services
      .filter((s) => s.farrowing_date || s.confirmed === true)
      .map((s) => ({
        parity_number: Number(s.farrowing_parity ?? s.breeding_parity),
        mating_date: String(s.mating_date).slice(0, 10),
        farrowing_date: s.farrowing_date ? String(s.farrowing_date).slice(0, 10) : null,
        weaning_date: s.weaning_date ? String(s.weaning_date).slice(0, 10) : null,
        piglets_born_live: s.farrowing_date ? Number(s.piglets_born_live ?? 0) : null,
        piglets_weaned: s.weaning_date ? Number(s.piglets_weaned ?? 0) : null,
      }));

    return buildParityExpense({
      parities,
      events,
      costingStartDate: animal.costing_start_date ? String(animal.costing_start_date).slice(0, 10) : null,
      asOf: today(),
    });
  }
}
