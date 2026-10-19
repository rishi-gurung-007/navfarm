import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, asc, eq, gte, inArray, isNull, lte, or, sql, SQL } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { batchScopeConditions, farmScope } from '../../../common/farm-scope';
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
  Targets,
  targetsFromLifecycle,
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
  farm: { farm_id: string; farm_name: string };
  filters: { date_from: string; date_to: string; batch_no: string | null; parity: number | null; sow_code: string | null };
  generated_at: string;
  rows: FarrowingReportRow[];
}

@Injectable()
export class FarrowingReportService {
  constructor(private readonly cls: ClsService) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  async getFarrowingReport(tenantId: string, query: FarrowingReportQueryDto): Promise<FarrowingReport> {
    const scope = farmScope(this.cls);
    if (scope.companyId && query.companyId && query.companyId !== scope.companyId) {
      throw new ForbiddenException('Report company must match the workspace.');
    }
    if (scope.farmId && scope.farmId !== query.farmId) {
      throw new ForbiddenException('This farm is outside your workspace.');
    }
    const companyId = scope.companyId || query.companyId || null;

    const [farm] = await this.db
      .select({ farm_id: schema.locationMaster.location_id, farm_name: schema.locationMaster.location_name, company_id: schema.locationMaster.company_id })
      .from(schema.locationMaster)
      .where(and(eq(schema.locationMaster.location_id, query.farmId), eq(schema.locationMaster.tenant_id, tenantId)))
      .limit(1);
    if (!farm || (companyId && farm.company_id !== companyId)) throw new NotFoundException('Farm not found.');

    const batchConditions: SQL[] = [
      eq(schema.batchHeader.tenant_id, tenantId),
      eq(schema.batchHeader.farm_id, query.farmId),
      isNull(schema.batchHeader.deleted_at),
      ...batchScopeConditions(scope),
    ];
    if (companyId) batchConditions.push(eq(schema.batchHeader.company_id, companyId));
    const farmBatches = await this.db
      .select({ batch_id: schema.batchHeader.batch_id, batch_no: schema.batchHeader.batch_no, breed_id: schema.batchHeader.breed_id })
      .from(schema.batchHeader)
      .where(and(...batchConditions))
      .orderBy(asc(schema.batchHeader.batch_no));

    let sowCode: string | null = null;
    if (query.sowId) {
      const [sow] = await this.db
        .select({ animal_code: schema.animalRegister.animal_code })
        .from(schema.animalRegister)
        .where(and(eq(schema.animalRegister.animal_id, query.sowId), eq(schema.animalRegister.tenant_id, tenantId)))
        .limit(1);
      if (!sow) throw new NotFoundException('Sow not found.');
      sowCode = sow.animal_code;
    }

    const selected = query.batchId ? farmBatches.filter((b) => b.batch_id === query.batchId) : farmBatches;
    if (query.batchId && selected.length === 0) throw new NotFoundException('Batch not found on this farm.');

    const current = await this.periodData(selected.map((b) => b.batch_id), query, query.dateFrom, query.dateTo);
    // Prior year: the farm's batches of a year earlier, not the selected batch — batch numbers do not repeat.
    const prior = await this.periodData(farmBatches.map((b) => b.batch_id), query, minusOneYear(query.dateFrom), minusOneYear(query.dateTo));

    const firstServices = await this.firstServices(farmBatches.map((b) => b.batch_id));
    const batchNoById = new Map(farmBatches.map((b) => [b.batch_id, b.batch_no]));
    const candidates = farmBatches.map((b) => ({ batch_id: b.batch_id, first_service: firstServices.get(b.batch_id) ?? null }));
    const priorDateTo = minusOneYear(query.dateTo);

    const targetsByBreed = await this.targetsByBreed(tenantId, companyId, query.farmId, query.dateFrom, query.dateTo, selected.map((b) => b.breed_id));

    const rows: FarrowingReportRow[] = [];
    for (const batch of selected) {
      const services = current.services.filter((s) => s.batch_id === batch.batch_id);
      const farrowings = current.farrowings.filter((f) => f.batch_id === batch.batch_id);
      const metrics = computeFarrowingMetrics(services, farrowings, this.mortalityOf(current.mortality, farrowings), query.dateTo);
      if (isEmptyPeriod(metrics)) continue;
      const priorId = matchPriorBatch(firstServices.get(batch.batch_id), candidates.filter((c) => c.batch_id !== batch.batch_id));
      const priorFarrowings = priorId ? prior.farrowings.filter((f) => f.batch_id === priorId) : [];
      const priorMetrics = priorId
        ? computeFarrowingMetrics(
            prior.services.filter((s) => s.batch_id === priorId),
            priorFarrowings,
            this.mortalityOf(prior.mortality, priorFarrowings),
            priorDateTo,
          )
        : null;
      rows.push({
        batch_id: batch.batch_id,
        batch_no: batch.batch_no,
        is_total: false,
        metrics,
        targets: targetsByBreed.get(batch.breed_id ?? '') ?? targetsFromLifecycle([], query.farmId),
        prior_year: priorMetrics && !isEmptyPeriod(priorMetrics) ? priorMetrics : null,
        prior_batch_no: priorId ? batchNoById.get(priorId) ?? null : null,
      });
    }

    if (rows.length) {
      const inRows = new Set(rows.map((r) => r.batch_id));
      const farrowings = current.farrowings.filter((f) => inRows.has(f.batch_id));
      const totalMetrics = computeFarrowingMetrics(
        current.services.filter((s) => inRows.has(s.batch_id)),
        farrowings,
        this.mortalityOf(current.mortality, farrowings),
        query.dateTo,
      );
      const priorMetrics = computeFarrowingMetrics(prior.services, prior.farrowings, prior.mortality, priorDateTo);
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
      farm: { farm_id: farm.farm_id, farm_name: farm.farm_name },
      filters: { date_from: query.dateFrom, date_to: query.dateTo, batch_no: batchNo, parity: query.parity ?? null, sow_code: sowCode },
      generated_at: new Date().toISOString(),
      rows,
    };
  }

  /** The batches on a farm and the sows that have a service or a farrowing in them — the report's own pickers. */
  async getFilterOptions(tenantId: string, query: { companyId?: string; farmId: string }) {
    const scope = farmScope(this.cls);
    if (scope.farmId && scope.farmId !== query.farmId) throw new ForbiddenException('This farm is outside your workspace.');
    const companyId = scope.companyId || query.companyId || null;
    const conditions: SQL[] = [
      eq(schema.batchHeader.tenant_id, tenantId),
      eq(schema.batchHeader.farm_id, query.farmId),
      isNull(schema.batchHeader.deleted_at),
      ...batchScopeConditions(scope),
    ];
    if (companyId) conditions.push(eq(schema.batchHeader.company_id, companyId));
    const batches = await this.db
      .select({ batch_id: schema.batchHeader.batch_id, batch_no: schema.batchHeader.batch_no, status: schema.batchHeader.status })
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
    const sowBatchIds = new Set([...servedIn, ...farrowedIn].map((r) => r.batch_id));
    const sowIds = [...new Set([...served, ...farrowed].map((r) => r.animal_id).filter((id): id is string => Boolean(id)))];
    const sows = sowIds.length
      ? await this.db
          .select({ animal_id: schema.animalRegister.animal_id, animal_code: schema.animalRegister.animal_code, parity_count: schema.animalRegister.parity_count })
          .from(schema.animalRegister)
          .where(inArray(schema.animalRegister.animal_id, sowIds))
          .orderBy(asc(schema.animalRegister.animal_code))
      : [];
    return { batches: batches.filter((b) => sowBatchIds.has(b.batch_id)), sows };
  }

  /** Each batch's first service date (its service week), from all its services — not only those in the dates. */
  private async firstServices(batchIds: string[]): Promise<Map<string, string>> {
    if (!batchIds.length) return new Map();
    const rows = await this.db
      .select({ batch_id: schema.breedingRecord.batch_id, first: sql<string>`MIN(${schema.breedingRecord.mating_date})` })
      .from(schema.breedingRecord)
      .where(inArray(schema.breedingRecord.batch_id, batchIds))
      .groupBy(schema.breedingRecord.batch_id);
    return new Map(rows.filter((r) => r.batch_id && r.first).map((r) => [r.batch_id as string, String(r.first).slice(0, 10)]));
  }

  private mortalityOf(all: MortalityRow[], farrowings: FarrowingRow[]): MortalityRow[] {
    const lots = new Set(farrowings.map((f) => f.piglet_batch_id).filter(Boolean));
    return all.filter((m) => lots.has(m.piglet_batch_id));
  }

  /** Services and farrowings in the batches between the dates, with the piglet deaths of those litters. */
  private async periodData(batchIds: string[], query: FarrowingReportQueryDto, from: string, to: string) {
    if (!batchIds.length) return { services: [] as ServiceRow[], farrowings: [] as FarrowingRow[], mortality: [] as MortalityRow[] };

    const serviceConditions: SQL[] = [
      inArray(schema.breedingRecord.batch_id, batchIds),
      gte(schema.breedingRecord.mating_date, from),
      lte(schema.breedingRecord.mating_date, to),
    ];
    // Parity is the parity at farrowing (Rishi, 18 Oct); a service carries the litter it is for, so it matches as is.
    if (query.parity) serviceConditions.push(eq(schema.breedingRecord.parity_number, query.parity));
    if (query.sowId) serviceConditions.push(eq(schema.breedingRecord.sow_animal_id, query.sowId));
    const services = (
      await this.db
        .select({ batch_id: schema.breedingRecord.batch_id, parity_number: schema.breedingRecord.parity_number })
        .from(schema.breedingRecord)
        .where(and(...serviceConditions))
    ).map((s) => ({ batch_id: s.batch_id as string, parity_number: s.parity_number ?? null }));

    const farrowConditions: SQL[] = [
      inArray(schema.farrowingRecord.batch_id, batchIds),
      gte(schema.farrowingRecord.farrowing_date, from),
      lte(schema.farrowingRecord.farrowing_date, to),
    ];
    if (query.parity) farrowConditions.push(eq(schema.farrowingRecord.parity_number, query.parity));
    if (query.sowId) farrowConditions.push(eq(schema.farrowingRecord.sow_animal_id, query.sowId));
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
      avg_weaning_weight_kg: r.avg_weaning_weight_kg != null ? Number(r.avg_weaning_weight_kg) : null,
    }));

    const lots = [...new Set(farrowings.map((r) => r.piglet_batch_id).filter((id): id is string => Boolean(id)))];
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

    return { services, farrowings, mortality };
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
    const ids = [...new Set(breedIds.filter((id): id is string => Boolean(id)))];
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
    if (companyId) conditions.push(or(isNull(l.company_id), eq(l.company_id, companyId)) as SQL);
    const rows = await this.db
      .select({ breed_id: l.breed_id, farm_id: l.farm_id, kpi_thresholds: l.kpi_thresholds })
      .from(l)
      .where(and(...conditions));
    for (const id of ids) out.set(id, targetsFromLifecycle(rows.filter((r) => r.breed_id === id), farmId));
    return out;
  }
}
