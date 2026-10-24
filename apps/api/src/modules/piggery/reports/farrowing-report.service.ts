import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  SQL,
} from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import {
  batchScopeConditions,
  farmPickerConditions,
  farmScope,
} from '../../../common/farm-scope';
import { FarrowingReportQueryDto } from './farrowing-report.dto';
import {
  commonTargets,
  computeFarrowingMetrics,
  FarrowingMetrics,
  FarrowingRow,
  isEmptyPeriod,
  matchPriorBatch,
  minusOneYear,
  MortalityRow,
  ServiceRow,
  SowWeightRow,
  Targets,
  targetsFromLifecycle,
  WeanedRow,
  WeaningData,
} from './farrowing-report.metrics';

export interface FarrowingReportRow {
  batch_id: string | null;
  batch_no: string;
  is_total: boolean;
  metrics: FarrowingMetrics;
  targets: Targets;
  /**
   * A year earlier. A batch row: the batch that stood where this one stands a year before (matchPriorBatch), over
   * the same dates shifted back a year. The farm total: the whole farm over those dates. Null when there is none.
   */
  prior_year: FarrowingMetrics | null;
  /** The batch a batch row's prior year is read from; null on the total and when no batch matched. */
  prior_batch_no: string | null;
}

export interface FarrowingReport {
  farm: { farm_id: string; farm_code: string; farm_name: string };
  filters: {
    date_from: string;
    date_to: string;
    batch_no: string | null;
    parity: number | null;
    sow_code: string | null;
  };
  generated_at: string;
  rows: FarrowingReportRow[];
}

@Injectable()
export class FarrowingReportService {
  constructor(private readonly cls: ClsService) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb)
      throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  async getFarrowingReport(
    tenantId: string,
    query: FarrowingReportQueryDto,
  ): Promise<FarrowingReport> {
    const scope = farmScope(this.cls);
    if (
      scope.companyId &&
      query.companyId &&
      query.companyId !== scope.companyId
    ) {
      throw new ForbiddenException('Report company must match the workspace.');
    }
    if (scope.farmId && scope.farmId !== query.farmId) {
      throw new ForbiddenException('This farm is outside your workspace.');
    }
    const companyId = scope.companyId || query.companyId || null;

    const [farm] = await this.db
      .select({
        farm_id: schema.locationMaster.location_id,
        farm_code: schema.locationMaster.location_code,
        farm_name: schema.locationMaster.location_name,
        company_id: schema.locationMaster.company_id,
      })
      .from(schema.locationMaster)
      .where(
        and(
          eq(schema.locationMaster.location_id, query.farmId),
          eq(schema.locationMaster.tenant_id, tenantId),
        ),
      )
      .limit(1);
    if (!farm || (companyId && farm.company_id !== companyId))
      throw new NotFoundException('Farm not found.');

    const batchConditions: SQL[] = [
      eq(schema.batchHeader.tenant_id, tenantId),
      eq(schema.batchHeader.farm_id, query.farmId),
      isNull(schema.batchHeader.deleted_at),
      ...batchScopeConditions(scope),
    ];
    if (companyId)
      batchConditions.push(eq(schema.batchHeader.company_id, companyId));
    const farmBatches = await this.db
      .select({
        batch_id: schema.batchHeader.batch_id,
        batch_no: schema.batchHeader.batch_no,
        breed_id: schema.batchHeader.breed_id,
      })
      .from(schema.batchHeader)
      .where(and(...batchConditions))
      .orderBy(asc(schema.batchHeader.batch_no));

    let sowCode: string | null = null;
    if (query.sowId) {
      const [sow] = await this.db
        .select({ animal_code: schema.animalRegister.animal_code })
        .from(schema.animalRegister)
        .where(
          and(
            eq(schema.animalRegister.animal_id, query.sowId),
            eq(schema.animalRegister.tenant_id, tenantId),
          ),
        )
        .limit(1);
      if (!sow) throw new NotFoundException('Sow not found.');
      sowCode = sow.animal_code;
    }

    const selected = query.batchId
      ? farmBatches.filter((b) => b.batch_id === query.batchId)
      : farmBatches;
    if (query.batchId && selected.length === 0)
      throw new NotFoundException('Batch not found on this farm.');

    const current = await this.periodData(
      selected.map((b) => b.batch_id),
      query,
      query.dateFrom,
      query.dateTo,
    );
    // Prior year: the farm's batches of a year earlier, not the selected batch — batch numbers do not repeat.
    const prior = await this.periodData(
      farmBatches.map((b) => b.batch_id),
      query,
      minusOneYear(query.dateFrom),
      minusOneYear(query.dateTo),
    );

    const firstServices = await this.firstServices(
      farmBatches.map((b) => b.batch_id),
    );
    const batchNoById = new Map(
      farmBatches.map((b) => [b.batch_id, b.batch_no]),
    );
    const candidates = farmBatches.map((b) => ({
      batch_id: b.batch_id,
      first_service: firstServices.get(b.batch_id) ?? null,
    }));
    const priorDateTo = minusOneYear(query.dateTo);

    const targetsByBreed = await this.targetsByBreed(
      tenantId,
      farm.company_id,
      query.farmId,
      query.dateFrom,
      query.dateTo,
      selected.map((b) => b.breed_id),
    );

    const rows: FarrowingReportRow[] = [];
    for (const batch of selected) {
      const services = current.services.filter(
        (s) => s.batch_id === batch.batch_id,
      );
      const farrowings = current.farrowings.filter(
        (f) => f.batch_id === batch.batch_id,
      );
      const metrics = computeFarrowingMetrics(
        services,
        farrowings,
        this.mortalityOf(current.mortality, farrowings),
        query.dateTo,
        this.weaningOf(current, [batch.batch_id]),
      );
      if (isEmptyPeriod(metrics)) continue;
      const priorId = matchPriorBatch(
        firstServices.get(batch.batch_id),
        candidates.filter((c) => c.batch_id !== batch.batch_id),
      );
      const priorFarrowings = priorId
        ? prior.farrowings.filter((f) => f.batch_id === priorId)
        : [];
      const priorMetrics = priorId
        ? computeFarrowingMetrics(
            prior.services.filter((s) => s.batch_id === priorId),
            priorFarrowings,
            this.mortalityOf(prior.mortality, priorFarrowings),
            priorDateTo,
            this.weaningOf(prior, [priorId]),
          )
        : null;
      rows.push({
        batch_id: batch.batch_id,
        batch_no: batch.batch_no,
        is_total: false,
        metrics,
        targets:
          targetsByBreed.get(batch.breed_id ?? '') ??
          targetsFromLifecycle([], query.farmId),
        prior_year:
          priorMetrics && !isEmptyPeriod(priorMetrics) ? priorMetrics : null,
        prior_batch_no: priorId ? (batchNoById.get(priorId) ?? null) : null,
      });
    }

    if (rows.length) {
      const inRows = new Set(rows.map((r) => r.batch_id));
      const farrowings = current.farrowings.filter((f) =>
        inRows.has(f.batch_id),
      );
      const totalMetrics = computeFarrowingMetrics(
        current.services.filter((s) => inRows.has(s.batch_id)),
        farrowings,
        this.mortalityOf(current.mortality, farrowings),
        query.dateTo,
        this.weaningOf(
          current,
          [...inRows].filter((id): id is string => Boolean(id)),
        ),
      );
      const priorMetrics = computeFarrowingMetrics(
        prior.services,
        prior.farrowings,
        prior.mortality,
        priorDateTo,
        prior,
      );
      rows.push({
        batch_id: null,
        batch_no: farm.farm_name,
        is_total: true,
        metrics: totalMetrics,
        targets: commonTargets(rows.map((r) => r.targets)),
        prior_year: isEmptyPeriod(priorMetrics) ? null : priorMetrics,
        prior_batch_no: null,
      });
    }

    const batchNo = query.batchId ? selected[0].batch_no : null;
    return {
      farm: {
        farm_id: farm.farm_id,
        farm_code: farm.farm_code,
        farm_name: farm.farm_name,
      },
      filters: {
        date_from: query.dateFrom,
        date_to: query.dateTo,
        batch_no: batchNo,
        parity: query.parity ?? null,
        sow_code: sowCode,
      },
      generated_at: new Date().toISOString(),
      rows,
    };
  }

  /** The farms this caller may report on, with the company each belongs to (farmPickerConditions). */
  async listFarms(tenantId: string, userType: string | undefined) {
    const conditions = farmPickerConditions(
      farmScope(this.cls),
      tenantId,
      userType,
    );
    if (!conditions) return [];
    const L = schema.locationMaster;
    return this.db
      .select({
        farm_id: L.location_id,
        farm_code: L.location_code,
        farm_name: L.location_name,
        company_id: L.company_id,
        company_name: schema.companyMaster.company_name,
      })
      .from(L)
      .leftJoin(
        schema.companyMaster,
        eq(schema.companyMaster.company_id, L.company_id),
      )
      .where(and(...conditions))
      .orderBy(asc(L.location_code));
  }

  /** The batches on a farm and the sows that have a service or a farrowing in them — the report's own pickers. */
  async getFilterOptions(
    tenantId: string,
    query: { companyId?: string; farmId: string },
  ) {
    const scope = farmScope(this.cls);
    if (scope.farmId && scope.farmId !== query.farmId)
      throw new ForbiddenException('This farm is outside your workspace.');
    const companyId = scope.companyId || query.companyId || null;
    const conditions: SQL[] = [
      eq(schema.batchHeader.tenant_id, tenantId),
      eq(schema.batchHeader.farm_id, query.farmId),
      isNull(schema.batchHeader.deleted_at),
      ...batchScopeConditions(scope),
    ];
    if (companyId)
      conditions.push(eq(schema.batchHeader.company_id, companyId));
    const batches = await this.db
      .select({
        batch_id: schema.batchHeader.batch_id,
        batch_no: schema.batchHeader.batch_no,
        status: schema.batchHeader.status,
      })
      .from(schema.batchHeader)
      .where(and(...conditions))
      .orderBy(asc(schema.batchHeader.batch_no));
    const batchIds = batches.map((b) => b.batch_id);
    if (!batchIds.length) return { batches: [], sows: [] };

    const served = await this.db
      .selectDistinct({ animal_id: schema.breedingRecord.sow_animal_id })
      .from(schema.breedingRecord)
      .where(inArray(schema.breedingRecord.batch_id, batchIds));
    const farrowed = await this.db
      .selectDistinct({ animal_id: schema.farrowingRecord.sow_animal_id })
      .from(schema.farrowingRecord)
      .where(inArray(schema.farrowingRecord.batch_id, batchIds));
    // Only sow batches — the farm's piglet lots are batches too, and they have no services or farrowings.
    const servedIn = await this.db
      .selectDistinct({ batch_id: schema.breedingRecord.batch_id })
      .from(schema.breedingRecord)
      .where(inArray(schema.breedingRecord.batch_id, batchIds));
    const farrowedIn = await this.db
      .selectDistinct({ batch_id: schema.farrowingRecord.batch_id })
      .from(schema.farrowingRecord)
      .where(inArray(schema.farrowingRecord.batch_id, batchIds));
    const sowBatchIds = new Set(
      [...servedIn, ...farrowedIn].map((r) => r.batch_id),
    );
    const sowIds = [
      ...new Set(
        [...served, ...farrowed]
          .map((r) => r.animal_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const sows = sowIds.length
      ? await this.db
          .select({
            animal_id: schema.animalRegister.animal_id,
            animal_code: schema.animalRegister.animal_code,
            parity_count: schema.animalRegister.parity_count,
          })
          .from(schema.animalRegister)
          .where(inArray(schema.animalRegister.animal_id, sowIds))
          .orderBy(asc(schema.animalRegister.animal_code))
      : [];
    return {
      batches: batches.filter((b) => sowBatchIds.has(b.batch_id)),
      sows,
    };
  }

  /** Each batch's first service date (its service week), from all its services — not only those in the dates. */
  private async firstServices(
    batchIds: string[],
  ): Promise<Map<string, string>> {
    if (!batchIds.length) return new Map();
    const rows = await this.db
      .select({
        batch_id: schema.breedingRecord.batch_id,
        first: sql<string>`MIN(${schema.breedingRecord.mating_date})`,
      })
      .from(schema.breedingRecord)
      .where(inArray(schema.breedingRecord.batch_id, batchIds))
      .groupBy(schema.breedingRecord.batch_id);
    return new Map(
      rows
        .filter((r) => r.batch_id && r.first)
        .map((r) => [r.batch_id as string, String(r.first).slice(0, 10)]),
    );
  }

  /** The weaned litters of some batches, with the weights of their sows. */
  private weaningOf(data: WeaningData, batchIds: string[]): WeaningData {
    const ids = new Set(batchIds);
    return {
      weaned: data.weaned.filter((w) => ids.has(w.batch_id)),
      weights: data.weights,
    };
  }

  private mortalityOf(
    all: MortalityRow[],
    farrowings: FarrowingRow[],
  ): MortalityRow[] {
    const lots = new Set(
      farrowings.map((f) => f.piglet_batch_id).filter(Boolean),
    );
    return all.filter((m) => lots.has(m.piglet_batch_id));
  }

  /** Services and farrowings in the batches between the dates, with the piglet deaths of those litters. */
  private async periodData(
    batchIds: string[],
    query: FarrowingReportQueryDto,
    from: string,
    to: string,
  ) {
    if (!batchIds.length) {
      return {
        services: [] as ServiceRow[],
        farrowings: [] as FarrowingRow[],
        mortality: [] as MortalityRow[],
        weaned: [] as WeanedRow[],
        weights: [] as SowWeightRow[],
      };
    }

    const serviceConditions: SQL[] = [
      inArray(schema.breedingRecord.batch_id, batchIds),
      gte(schema.breedingRecord.mating_date, from),
      lte(schema.breedingRecord.mating_date, to),
    ];
    // Parity is the parity at farrowing (Rishi, 18 Oct); a service carries the litter it is for, so it matches as is.
    if (query.parity)
      serviceConditions.push(
        eq(schema.breedingRecord.parity_number, query.parity),
      );
    if (query.sowId)
      serviceConditions.push(
        eq(schema.breedingRecord.sow_animal_id, query.sowId),
      );
    const services = (
      await this.db
        .select({
          batch_id: schema.breedingRecord.batch_id,
          parity_number: schema.breedingRecord.parity_number,
        })
        .from(schema.breedingRecord)
        .where(and(...serviceConditions))
    ).map((s) => ({
      batch_id: s.batch_id as string,
      parity_number: s.parity_number ?? null,
    }));

    const farrowConditions: SQL[] = [
      inArray(schema.farrowingRecord.batch_id, batchIds),
      gte(schema.farrowingRecord.farrowing_date, from),
      lte(schema.farrowingRecord.farrowing_date, to),
    ];
    if (query.parity)
      farrowConditions.push(
        eq(schema.farrowingRecord.parity_number, query.parity),
      );
    if (query.sowId)
      farrowConditions.push(
        eq(schema.farrowingRecord.sow_animal_id, query.sowId),
      );
    const f = schema.farrowingRecord;
    const farrowings: FarrowingRow[] = (
      await this.db
        .select({
          batch_id: f.batch_id,
          farrow_id: f.farrow_id,
          piglet_batch_id: f.piglet_batch_id,
          piglets_born_total: f.piglets_born_total,
          piglets_born_live: f.piglets_born_live,
          piglets_stillborn: f.piglets_stillborn,
          piglets_mummified: f.piglets_mummified,
          foster_received: f.foster_received,
          fostered_out: f.fostered_out,
          weaning_date: f.weaning_date,
          piglets_weaned: f.piglets_weaned,
          avg_weaning_weight_kg: f.avg_weaning_weight_kg,
        })
        .from(f)
        .where(and(...farrowConditions))
    ).map((r) => ({
      batch_id: r.batch_id as string,
      farrow_id: r.farrow_id,
      piglet_batch_id: r.piglet_batch_id ?? null,
      piglets_born_total: Number(r.piglets_born_total ?? 0),
      piglets_born_live: Number(r.piglets_born_live ?? 0),
      piglets_stillborn: Number(r.piglets_stillborn ?? 0),
      piglets_mummified: Number(r.piglets_mummified ?? 0),
      foster_received: Number(r.foster_received ?? 0),
      fostered_out: Number(r.fostered_out ?? 0),
      weaning_date: r.weaning_date ? String(r.weaning_date).slice(0, 10) : null,
      piglets_weaned: Number(r.piglets_weaned ?? 0),
      avg_weaning_weight_kg:
        r.avg_weaning_weight_kg != null
          ? Number(r.avg_weaning_weight_kg)
          : null,
    }));

    const lots = [
      ...new Set(
        farrowings
          .map((r) => r.piglet_batch_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const mortality: MortalityRow[] = lots.length
      ? (
          await this.db
            .select({
              piglet_batch_id: schema.batchTransaction.batch_id,
              transaction_date: schema.batchTransaction.transaction_date,
              quantity: schema.batchTransaction.quantity,
            })
            .from(schema.batchTransaction)
            .where(
              and(
                inArray(schema.batchTransaction.batch_id, lots),
                eq(schema.batchTransaction.transaction_type, 'MORTALITY'),
                isNull(schema.batchTransaction.reversed_at),
              ),
            )
        ).map((m) => ({
          piglet_batch_id: m.piglet_batch_id as string,
          transaction_date: String(m.transaction_date).slice(0, 10),
          quantity: Number(m.quantity ?? 0),
        }))
      : [];

    // Litters weaned between the dates, whenever farrowed — Average Wean per Sow and Gilt Maternal Body Loss.
    const weanConditions: SQL[] = [
      inArray(f.batch_id, batchIds),
      gte(f.weaning_date, from),
      lte(f.weaning_date, to),
    ];
    if (query.parity) weanConditions.push(eq(f.parity_number, query.parity));
    if (query.sowId) weanConditions.push(eq(f.sow_animal_id, query.sowId));
    const weaned: WeanedRow[] = (
      await this.db
        .select({
          batch_id: f.batch_id,
          sow_animal_id: f.sow_animal_id,
          parity_number: f.parity_number,
          farrowing_date: f.farrowing_date,
          weaning_date: f.weaning_date,
          piglets_weaned: f.piglets_weaned,
        })
        .from(f)
        .where(and(...weanConditions))
    ).map((r) => ({
      batch_id: r.batch_id as string,
      sow_animal_id: r.sow_animal_id,
      parity_number: Number(r.parity_number),
      farrowing_date: String(r.farrowing_date).slice(0, 10),
      weaning_date: String(r.weaning_date).slice(0, 10),
      piglets_weaned: Number(r.piglets_weaned ?? 0),
    }));

    // The gilts' posted body weights from data entry, taken in gestation or lactation, up to the last weaning.
    const gilts = [
      ...new Set(
        weaned.filter((w) => w.parity_number === 1).map((w) => w.sow_animal_id),
      ),
    ];
    const d = schema.batchDailyData;
    const weights: SowWeightRow[] = gilts.length
      ? (
          await this.db
            .select({
              animal_id: d.animal_id,
              stage_code: schema.stageMaster.stage_code,
              entry_date: d.entry_date,
              value: d.entered_value,
            })
            .from(d)
            .innerJoin(
              schema.schedulerLine,
              eq(d.line_id, schema.schedulerLine.line_id),
            )
            .innerJoin(
              schema.schedulerHeader,
              eq(
                schema.schedulerLine.scheduler_id,
                schema.schedulerHeader.scheduler_id,
              ),
            )
            .innerJoin(
              schema.stageMaster,
              eq(schema.schedulerHeader.stage_id, schema.stageMaster.stage_id),
            )
            .where(
              and(
                inArray(d.animal_id, gilts),
                eq(d.posted, true),
                isNotNull(d.entered_value),
                lte(d.entry_date, to),
                eq(schema.schedulerLine.kpi_metric, 'BODY_WEIGHT'),
                inArray(schema.stageMaster.stage_code, [
                  'GESTATION',
                  'LACTATION',
                ]),
              ),
            )
        ).map((w) => ({
          animal_id: w.animal_id as string,
          stage_code: w.stage_code as SowWeightRow['stage_code'],
          entry_date: String(w.entry_date).slice(0, 10),
          weight_kg: Number(w.value),
        }))
      : [];

    return { services, farrowings, mortality, weaned, weights };
  }

  /** Each breed's KPI targets from its active lifecycle rows in force during the dates. */
  private async targetsByBreed(
    tenantId: string,
    companyId: string | null,
    farmId: string,
    from: string,
    to: string,
    breedIds: Array<string | null>,
  ): Promise<Map<string, Targets>> {
    const ids = [
      ...new Set(breedIds.filter((id): id is string => Boolean(id))),
    ];
    const out = new Map<string, Targets>();
    if (!ids.length) return out;
    const l = schema.breedLifecycleStages;
    const conditions: SQL[] = [
      eq(l.tenant_id, tenantId),
      inArray(l.breed_id, ids),
      eq(l.is_active, true),
      isNull(l.retired_at),
      or(isNull(l.farm_id), eq(l.farm_id, farmId)) as SQL,
      or(isNull(l.effective_from), lte(l.effective_from, to)) as SQL,
      or(isNull(l.effective_to), gte(l.effective_to, from)) as SQL,
    ];
    // A company reads only its own rows (Rishi, 20 Oct): no tenant template, no other company's.
    conditions.push(
      companyId ? eq(l.company_id, companyId) : isNull(l.company_id),
    );
    const rows = await this.db
      .select({
        breed_id: l.breed_id,
        farm_id: l.farm_id,
        kpi_thresholds: l.kpi_thresholds,
      })
      .from(l)
      .where(and(...conditions));
    for (const id of ids)
      out.set(
        id,
        targetsFromLifecycle(
          rows.filter((r) => r.breed_id === id),
          farmId,
        ),
      );
    return out;
  }
}
