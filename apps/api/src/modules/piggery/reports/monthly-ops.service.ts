import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { batchScopeConditions, farmPickerConditions, farmScope } from '../../../common/farm-scope';
import { AccountingPeriodService } from '../../master-data/accounting-period/accounting-period.service';
import { fiscalYears } from '../../master-data/accounting-period/accounting-period.rules';
import { MonthlyOpsQueryDto } from './monthly-ops.dto';
import {
  computeMonthlyOps, DEFAULT_GESTATION_DAYS, OpsDeath, OpsFarrowing, OpsMetrics, OpsSale, OpsService, OpsSow,
} from './monthly-ops.metrics';

export interface MonthlyOpsRow {
  month: string;
  start_date: string;
  end_date: string;
  breed_id: string;
  breed_name: string;
  metrics: OpsMetrics;
}

export interface MonthlyOpsReport {
  farm: { farm_id: string; farm_code: string; farm_name: string };
  year: string;
  generated_at: string;
  rows: MonthlyOpsRow[];
}

/** The customer CDM counts: its name or code says Colcom. */
const COLCOM = '%COLCOM%';

/**
 * R12 Monthly Ops (Triple-C_reports COMMENTS.xlsx): one row per accounting month of the chosen fiscal year
 * (Accounting Period Master, up to today) and per sow breed on the farm. A litter or service counts for the farm
 * of its batch; a sow, sale or cull for the farm of the animal's location; a death for its batch's farm and breed.
 */
@Injectable()
export class MonthlyOpsService {
  constructor(private readonly cls: ClsService, private readonly periods: AccountingPeriodService) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  private companyFor(requested?: string): string | null {
    const scope = farmScope(this.cls);
    if (scope.companyId && requested && requested !== scope.companyId)
      throw new ForbiddenException('Report company must match the workspace.');
    return scope.companyId || requested || null;
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /** The fiscal years the Accounting Period Master holds, and the one holding today. */
  async years(tenantId: string, companyId?: string) {
    const calendar = await this.periods.calendar(this.companyFor(companyId), tenantId);
    return fiscalYears(calendar, this.today());
  }

  /** The farms this caller may report on (farmPickerConditions), as R07 lists them. */
  async listFarms(tenantId: string, userType: string | undefined) {
    const conditions = farmPickerConditions(farmScope(this.cls), tenantId, userType);
    if (!conditions) return [];
    const L = schema.locationMaster;
    return this.db
      .select({ farm_id: L.location_id, farm_code: L.location_code, farm_name: L.location_name, company_id: L.company_id })
      .from(L).where(and(...conditions)).orderBy(L.location_code);
  }

  async getReport(tenantId: string, query: MonthlyOpsQueryDto): Promise<MonthlyOpsReport> {
    const scope = farmScope(this.cls);
    if (scope.farmId && scope.farmId !== query.farmId) throw new ForbiddenException('This farm is outside your workspace.');
    const companyId = this.companyFor(query.companyId);
    const L = schema.locationMaster;
    const [farm] = await this.db
      .select({ farm_id: L.location_id, farm_code: L.location_code, farm_name: L.location_name, company_id: L.company_id })
      .from(L).where(and(eq(L.location_id, query.farmId), eq(L.tenant_id, tenantId))).limit(1);
    if (!farm || (companyId && farm.company_id !== companyId)) throw new NotFoundException('Farm not found.');

    const today = this.today();
    const months = (await this.periods.calendar(farm.company_id ?? companyId, tenantId))
      .filter((m) => m.fiscalYear === query.year && m.startDate <= today)
      .map((m) => ({ name: m.name, startDate: m.startDate, endDate: !m.endDate || m.endDate > today ? today : m.endDate }));
    if (!months.length) {
      throw new BadRequestException(`The Accounting Period Master has no month of fiscal year ${query.year} up to today.`);
    }
    const yearStart = months[0].startDate;
    const yearEnd = months[months.length - 1].endDate;

    const A = schema.animalRegister;
    const Loc = schema.locationMaster;
    const B = schema.batchHeader;
    const farmBatches = this.db.select({ id: B.batch_id }).from(B)
      .where(and(eq(B.tenant_id, tenantId), eq(B.farm_id, farm.farm_id), isNull(B.deleted_at), ...batchScopeConditions(scope)));

    // Sows of the farm: those located on it, and any with a service or litter on its batches.
    const sowRows = await this.db
      .select({
        animal_id: A.animal_id, breed_id: A.breed_id, entry_date: A.entry_date,
        disposal_date: A.disposal_date, cull_date: A.cull_date,
      })
      .from(A)
      .leftJoin(Loc, eq(Loc.location_id, A.current_location_id))
      .where(and(
        eq(A.tenant_id, tenantId), eq(A.gender, 'F'), inArray(A.animal_type, ['SOW', 'GILT']),
        or(
          eq(Loc.farm_id, farm.farm_id),
          inArray(A.animal_id, this.db.select({ id: schema.breedingRecord.sow_animal_id }).from(schema.breedingRecord).where(inArray(schema.breedingRecord.batch_id, farmBatches))),
          inArray(A.animal_id, this.db.select({ id: schema.farrowingRecord.sow_animal_id }).from(schema.farrowingRecord).where(inArray(schema.farrowingRecord.batch_id, farmBatches))),
        ),
      ));
    const sowIds = sowRows.map((s) => s.animal_id);
    const breedOfSow = new Map(sowRows.map((s) => [s.animal_id, s.breed_id ?? '']));

    const F = schema.farrowingRecord;
    const farrowings = sowIds.length ? await this.db.select({
      sow_animal_id: F.sow_animal_id, breeding_id: F.breeding_id, farrowing_date: F.farrowing_date,
      piglets_born_total: F.piglets_born_total, piglets_born_live: F.piglets_born_live,
      weaning_date: F.weaning_date, piglets_weaned: F.piglets_weaned, avg_weaning_weight_kg: F.avg_weaning_weight_kg,
    }).from(F).where(inArray(F.sow_animal_id, sowIds)) : [];
    const R = schema.breedingRecord;
    const services = sowIds.length ? await this.db.select({
      breeding_id: R.breeding_id, sow_animal_id: R.sow_animal_id, mating_date: R.mating_date,
      expected_farrowing_date: R.expected_farrowing_date, conception_result: R.conception_result, preg_check_date: R.preg_check_date,
    }).from(R).where(inArray(R.sow_animal_id, sowIds)) : [];

    // Sales of the farm's animals (any type) in the year, with the customer the sale's ledger entry names.
    const sales = await this.db.select({
      breed_id: A.breed_id, disposal_date: A.disposal_date, exit_weight_kg: A.exit_weight_kg,
      is_colcom: sql<number>`EXISTS (SELECT 1 FROM bio_asset_ledger bal JOIN customer_master cm ON cm.customer_id = bal.customer_id
        WHERE bal.animal_id = ${A.animal_id} AND (UPPER(cm.customer_name) LIKE ${COLCOM} OR UPPER(cm.customer_code) LIKE ${COLCOM}))`,
    }).from(A).leftJoin(Loc, eq(Loc.location_id, A.current_location_id))
      .where(and(eq(A.tenant_id, tenantId), eq(A.disposal_type, 'SOLD'), eq(Loc.farm_id, farm.farm_id),
        sql`${A.disposal_date} BETWEEN ${yearStart} AND ${yearEnd}`));

    // Deaths on the farm's batches in the year, each with its Reason Master category (matched on the cause's name).
    const T = schema.batchTransaction;
    const deaths = await this.db.select({
      breed_id: B.breed_id, transaction_date: T.transaction_date, quantity: T.quantity,
      category: sql<string | null>`(SELECT rm.sub_category FROM batch_mortality_detail d JOIN reason_master rm
        ON rm.category = 'MORTALITY' AND UPPER(rm.reason_name) = UPPER(d.cause_of_death)
        WHERE d.transaction_id = ${T.transaction_id} LIMIT 1)`,
    }).from(T).innerJoin(B, eq(B.batch_id, T.batch_id))
      .where(and(eq(T.transaction_type, 'MORTALITY'), inArray(T.batch_id, farmBatches),
        sql`${T.transaction_date} BETWEEN ${yearStart} AND ${yearEnd}`));

    const breedIds = [...new Set(sowRows.map((s) => s.breed_id).filter((b): b is string => !!b))];
    const breeds = breedIds.length ? await this.db.select({
      breed_id: schema.breedMaster.breed_id, breed_name: schema.breedMaster.breed_name, gestation_days: schema.breedMaster.gestation_days,
    }).from(schema.breedMaster).where(inArray(schema.breedMaster.breed_id, breedIds)).orderBy(schema.breedMaster.breed_name) : [];

    const num = (v: unknown) => (v == null ? null : Number(v));
    const rows: MonthlyOpsRow[] = [];
    for (const month of months) {
      for (const breed of breeds) {
        const ofBreed = (sowId: string) => breedOfSow.get(sowId) === breed.breed_id;
        const opsFarrowings: OpsFarrowing[] = farrowings.filter((f) => ofBreed(f.sow_animal_id)).map((f) => ({
          sow_animal_id: f.sow_animal_id, breeding_id: f.breeding_id ?? null, farrowing_date: String(f.farrowing_date).slice(0, 10),
          piglets_born_total: Number(f.piglets_born_total ?? 0), piglets_born_live: Number(f.piglets_born_live ?? 0),
          weaning_date: f.weaning_date ? String(f.weaning_date).slice(0, 10) : null,
          piglets_weaned: Number(f.piglets_weaned ?? 0), avg_weaning_weight_kg: num(f.avg_weaning_weight_kg),
        }));
        const opsServices: OpsService[] = services.filter((s) => ofBreed(s.sow_animal_id)).map((s) => ({
          breeding_id: s.breeding_id, sow_animal_id: s.sow_animal_id, mating_date: String(s.mating_date).slice(0, 10),
          expected_farrowing_date: s.expected_farrowing_date ? String(s.expected_farrowing_date).slice(0, 10) : null,
          conception_result: s.conception_result ?? null,
          preg_check_date: s.preg_check_date ? String(s.preg_check_date).slice(0, 10) : null,
        }));
        const opsSows: OpsSow[] = sowRows.filter((s) => s.breed_id === breed.breed_id).map((s) => ({
          animal_id: s.animal_id, entry_date: s.entry_date ? String(s.entry_date).slice(0, 10) : null,
          exit_date: (s.disposal_date ?? s.cull_date) ? String(s.disposal_date ?? s.cull_date).slice(0, 10) : null,
          cull_date: s.cull_date ? String(s.cull_date).slice(0, 10) : null,
        }));
        const opsSales: OpsSale[] = sales.filter((s) => s.breed_id === breed.breed_id && s.disposal_date).map((s) => ({
          disposal_date: String(s.disposal_date).slice(0, 10), exit_weight_kg: num(s.exit_weight_kg), is_colcom: Boolean(Number(s.is_colcom)),
        }));
        const opsDeaths: OpsDeath[] = deaths.filter((d) => d.breed_id === breed.breed_id).map((d) => ({
          transaction_date: String(d.transaction_date).slice(0, 10), quantity: Number(d.quantity ?? 0), category: d.category ?? null,
        }));
        rows.push({
          month: month.name, start_date: month.startDate, end_date: month.endDate,
          breed_id: breed.breed_id, breed_name: breed.breed_name,
          metrics: computeMonthlyOps({
            month, gestationDays: breed.gestation_days ?? DEFAULT_GESTATION_DAYS,
            farrowings: opsFarrowings, services: opsServices, sows: opsSows, sales: opsSales, deaths: opsDeaths,
          }),
        });
      }
    }
    return { farm: { farm_id: farm.farm_id, farm_code: farm.farm_code, farm_name: farm.farm_name }, year: query.year, generated_at: new Date().toISOString(), rows };
  }
}
