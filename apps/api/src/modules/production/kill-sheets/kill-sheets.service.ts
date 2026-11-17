import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, like, or, sql } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../core/database/schema';
import { farmScope } from '../../../common/farm-scope';
import { withTenantTransaction } from '../../../common/tenant-transaction';
import { parseIndividualKillSheet, parseProductSummary, type ImportIssue, type ParsedKillSheet, type ParsedProductSummary } from './kill-sheet-parser';
import { KillSheetStorageService, type KillSheetFileKind } from './kill-sheet-storage.service';
import { ConfirmKillSheetDto, QueryKillSheetsDto } from './kill-sheets.dto';

const number = (value: string | null | undefined) => value == null ? null : Number(value);
const total = (rows: Array<Record<string, string | null>>, field: string) => rows.reduce((sum, row) => sum + (number(row[field]) ?? 0), 0);
const round = (value: number) => Number(value.toFixed(4));

function extractReportMetadata(
  individual: ParsedKillSheet,
  summary: ParsedProductSummary | null,
  individualFileName: string,
  summaryFileName?: string,
) {
  let reportReference: string | null = null;
  let reportBatchReference: string | null = null;
  let slaughterFrom: string | null = null;
  let slaughterTo: string | null = null;

  if (summary) {
    for (const text of Object.values(summary.metadata)) {
      const batchMatch = text.match(/Slaughter\s*Batch\s*:\s*([A-Za-z0-9_-]+)/i);
      if (batchMatch && !reportBatchReference) reportBatchReference = batchMatch[1].trim();

      const periodMatch = text.match(/Date\s*Period\s*:\s*(\d{4}[/-]\d{2}[/-]\d{2})\s*To\s*(\d{4}[/-]\d{2}[/-]\d{2})/i);
      if (periodMatch && !slaughterFrom) {
        slaughterFrom = periodMatch[1].replace(/\//g, '-') + ' 00:00:00';
        slaughterTo = periodMatch[2].replace(/\//g, '-') + ' 23:59:59';
      }

      const reportMatch = text.match(/\b(rpt[A-Za-z0-9_.-]+)\b/i);
      if (reportMatch && !reportReference) reportReference = reportMatch[1];
    }
  }

  if (!reportBatchReference) {
    const batchMatch = (summaryFileName || individualFileName).match(/Batch\s*([A-Za-z0-9_-]+)/i);
    if (batchMatch) reportBatchReference = batchMatch[1].trim();
  }

  if (!slaughterFrom && individual.records.length) {
    const dates = individual.records.map((r) => r.slaughtered_at).filter(Boolean) as string[];
    if (dates.length) {
      dates.sort();
      slaughterFrom = dates[0];
      slaughterTo = dates[dates.length - 1];
    }
  }

  return { reportReference, reportBatchReference, slaughterFrom, slaughterTo };
}

/** Reconciliation preserves every source number and reports differences instead of changing a value. */
export function reconcileKillSheet(individual: ParsedKillSheet, summary: ParsedProductSummary | null) {
  const issues: ImportIssue[] = [...individual.issues, ...(summary?.issues ?? [])];
  const actualCount = individual.records.length, actualWarm = round(total(individual.records, 'warm_mass_kg')), actualCold = round(total(individual.records, 'cold_mass_kg'));
  const compare = (label: string, expected: string | undefined, actual: number, suffix = '') => { const value = number(expected); if (value != null && Math.abs(value - actual) > 0.01) issues.push({ severity: 'WARNING', message: `${label} differs by ${round(actual - value)}${suffix}.` }); };
  compare('Footer animal count', individual.expected.animal_count, actualCount); compare('Footer warm mass', individual.expected.warm_mass_kg, actualWarm, ' kg'); compare('Footer cold mass', individual.expected.cold_mass_kg, actualCold, ' kg');
  if (summary) {
    const quantity = round(total(summary.records, 'quantity')), warm = round(total(summary.records, 'warm_mass_kg')), cold = round(total(summary.records, 'cold_mass_kg')), value = round(total(summary.records, 'reported_value'));
    compare('Summary grand quantity', summary.expected.quantity, quantity); compare('Summary grand warm mass', summary.expected.warm_mass_kg, warm, ' kg'); compare('Summary grand cold mass', summary.expected.cold_mass_kg, cold, ' kg'); compare('Summary grand value', summary.expected.value, value);
    if (Math.abs(quantity - actualCount) > .01) issues.push({ severity: 'WARNING', message: `Summary quantity differs from individual carcass count by ${round(quantity - actualCount)}.` });
    if (Math.abs(warm - actualWarm) > .01) issues.push({ severity: 'WARNING', message: `Summary warm mass differs from individual records by ${round(warm - actualWarm)} kg.` });
    if (Math.abs(cold - actualCold) > .01) issues.push({ severity: 'WARNING', message: `Summary cold mass differs from individual records by ${round(cold - actualCold)} kg.` });
  }
  const invalid = issues.some((issue) => issue.severity === 'ERROR');
  return { issues, actualCount, actualWarm, actualCold, reconciliation: invalid ? 'INVALID' : issues.length ? 'WARNING' : 'MATCHED', reportedProductValue: summary ? String(round(total(summary.records, 'reported_value'))) : null };
}

@Injectable()
export class KillSheetsService {
  constructor(private readonly cls: ClsService, private readonly storage: KillSheetStorageService) {}
  private get db(): MySql2Database<typeof schema> { const db = this.cls.get<MySql2Database<typeof schema>>('tenantDb'); if (!db) throw new Error('Tenant database connection context not established.'); return db; }
  private scope() { const s = farmScope(this.cls); return { companyId: s.companyId, farmId: s.farmId }; }
  private async importFor(id: string, tenantId: string) {
    const s = this.scope(); const [row] = await this.db.select().from(schema.killSheetImport).where(and(eq(schema.killSheetImport.import_id, id), eq(schema.killSheetImport.tenant_id, tenantId), ...(s.companyId ? [eq(schema.killSheetImport.company_id, s.companyId)] : []), ...(s.farmId ? [eq(schema.killSheetImport.farm_id, s.farmId)] : []))).limit(1);
    if (!row) throw new NotFoundException('Kill Sheet was not found in this workspace.'); return row;
  }
  private async batchFor(dto: { farm_id: string; batch_id: string }, tenantId: string) {
    const s = this.scope(); const [batch] = await this.db.select({ batch_id: schema.batchHeader.batch_id, farm_id: schema.batchHeader.farm_id, company_id: schema.batchHeader.company_id }).from(schema.batchHeader).where(and(eq(schema.batchHeader.batch_id, dto.batch_id), eq(schema.batchHeader.tenant_id, tenantId))).limit(1);
    if (!batch || batch.farm_id !== dto.farm_id || (s.companyId && batch.company_id !== s.companyId) || (s.farmId && batch.farm_id !== s.farmId)) throw new ForbiddenException('Choose a batch belonging to a farm in your workspace.'); return batch;
  }
  private async parseIndividual(file: Express.Multer.File) { this.storage.validateUpload(file, 'individual'); try { return await parseIndividualKillSheet(file.buffer); } catch { throw new BadRequestException('The individual file is not a readable XLS or XLSX workbook.'); } }
  private async parseSummary(file: Express.Multer.File) { this.storage.validateUpload(file, 'summary'); try { return await parseProductSummary(file.buffer); } catch { throw new BadRequestException('The summary file is not a readable XLS or XLSX workbook.'); } }

  async preview(dto: { farm_id: string; batch_id: string }, individual: Express.Multer.File | undefined, summary: Express.Multer.File | undefined, tenantId: string, userId?: string) {
    if (!individual) throw new BadRequestException('An individual Kill Sheet workbook is required.');
    const batch = await this.batchFor(dto, tenantId), parsed = await this.parseIndividual(individual), parsedSummary = summary ? await this.parseSummary(summary) : null, reconciliation = reconcileKillSheet(parsed, parsedSummary);
    // Parsing errors return a preview only: no private file and no database row are created.
    if (reconciliation.reconciliation === 'INVALID') return { persisted: false, ...reconciliation, individual: parsed, summary: parsedSummary };
    const importId = randomUUID(), storedIndividual = await this.storage.store(tenantId, importId, 'individual', individual); let storedSummary: { storageKey: string; fileName: string; sha512: string } | null = null;
    try {
      if (summary) storedSummary = await this.storage.store(tenantId, importId, 'summary', summary);
      const [duplicate] = await this.db.select({ id: schema.killSheetImport.import_id }).from(schema.killSheetImport).where(and(eq(schema.killSheetImport.tenant_id, tenantId), eq(schema.killSheetImport.batch_id, dto.batch_id), eq(schema.killSheetImport.individual_sha512, storedIndividual.sha512))).limit(1);
      if (duplicate) throw new ConflictException('This exact individual workbook was already imported for this batch.');
      const meta = extractReportMetadata(parsed, parsedSummary, storedIndividual.fileName, storedSummary?.fileName);
      await this.db.insert(schema.killSheetImport).values({
        import_id: importId, tenant_id: tenantId, company_id: batch.company_id!, farm_id: dto.farm_id, batch_id: dto.batch_id,
        status: 'PREVIEW_READY', reconciliation_status: reconciliation.reconciliation,
        report_reference: meta.reportReference, report_batch_reference: meta.reportBatchReference,
        slaughter_from: meta.slaughterFrom, slaughter_to: meta.slaughterTo,
        individual_file_name: storedIndividual.fileName, individual_storage_key: storedIndividual.storageKey, individual_sha512: storedIndividual.sha512,
        ...(storedSummary ? { summary_file_name: storedSummary.fileName, summary_storage_key: storedSummary.storageKey, summary_sha512: storedSummary.sha512 } : {}),
        expected_animal_count: number(parsed.expected.animal_count), expected_warm_mass_kg: parsed.expected.warm_mass_kg ?? null, expected_cold_mass_kg: parsed.expected.cold_mass_kg ?? null,
        actual_animal_count: reconciliation.actualCount, actual_warm_mass_kg: String(reconciliation.actualWarm), actual_cold_mass_kg: String(reconciliation.actualCold),
        reported_product_value: reconciliation.reportedProductValue, validation_json: reconciliation.issues,
        metadata_json: { individual: parsed.metadata, summary: parsedSummary?.metadata ?? null }, created_by: userId ?? null,
      });
    } catch (error) { await this.storage.remove(storedIndividual.storageKey); await this.storage.remove(storedSummary?.storageKey); throw error; }
    return this.detail(importId, tenantId);
  }

  async attachSummary(id: string, summaryFile: Express.Multer.File | undefined, tenantId: string) {
    if (!summaryFile) throw new BadRequestException('A product summary workbook is required.'); const row = await this.importFor(id, tenantId);
    if (row.summary_storage_key) throw new ConflictException('A product summary is already attached to this Kill Sheet.');
    const summary = await this.parseSummary(summaryFile), individual = await parseIndividualKillSheet(await this.storage.read(row.individual_storage_key)), reconciliation = reconcileKillSheet(individual, summary);
    if (reconciliation.reconciliation === 'INVALID') return { persisted: false, ...reconciliation, individual, summary };
    const stored = await this.storage.store(tenantId, id, 'summary', summaryFile);
    const meta = extractReportMetadata(individual, summary, row.individual_file_name, stored.fileName);
    try {
      await withTenantTransaction(this.cls, async () => {
        if (row.status === 'IMPORTED' && summary.records.length) await this.db.insert(schema.killSheetProduct).values(summary.records.map((record) => ({ import_id: id, ...record })));
        await this.db.update(schema.killSheetImport).set({
          summary_file_name: stored.fileName, summary_storage_key: stored.storageKey, summary_sha512: stored.sha512,
          reconciliation_status: reconciliation.reconciliation, reported_product_value: reconciliation.reportedProductValue,
          validation_json: reconciliation.issues,
          metadata_json: { ...((row.metadata_json as object) ?? {}), summary: summary.metadata },
          ...(row.report_reference ? {} : { report_reference: meta.reportReference }),
          ...(row.report_batch_reference ? {} : { report_batch_reference: meta.reportBatchReference }),
          ...(row.slaughter_from ? {} : { slaughter_from: meta.slaughterFrom }),
          ...(row.slaughter_to ? {} : { slaughter_to: meta.slaughterTo }),
          updated_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
        }).where(eq(schema.killSheetImport.import_id, id));
      });
    } catch (error) { await this.storage.remove(stored.storageKey); throw error; }
    return this.detail(id, tenantId);
  }

  async confirm(id: string, dto: ConfirmKillSheetDto, tenantId: string, userId?: string) {
    const row = await this.importFor(id, tenantId); if (row.status === 'IMPORTED') return this.detail(id, tenantId);
    const issues = (row.validation_json as ImportIssue[] | null) ?? []; if (issues.some((issue) => issue.severity === 'ERROR')) throw new BadRequestException('Resolve parsing errors before confirmation.'); if (row.reconciliation_status !== 'MATCHED' && !dto.override_reason?.trim()) throw new BadRequestException('A reconciliation warning requires an override reason.');
    const parsed = await parseIndividualKillSheet(await this.storage.read(row.individual_storage_key)), parsedSummary = row.summary_storage_key ? await parseProductSummary(await this.storage.read(row.summary_storage_key)) : null;
    return withTenantTransaction(this.cls, async () => {
      await this.db.insert(schema.killSheetCarcass).values(parsed.records.map((record) => ({ import_id: id, ...record })));
      if (parsedSummary?.records.length) await this.db.insert(schema.killSheetProduct).values(parsedSummary.records.map((record) => ({ import_id: id, ...record })));
      await this.db.update(schema.killSheetImport).set({ status: 'IMPORTED', confirmed_at: new Date().toISOString().slice(0, 19).replace('T', ' '), confirmed_by: userId ?? null, override_reason: dto.override_reason?.trim() ?? null, updated_at: new Date().toISOString().slice(0, 19).replace('T', ' ') }).where(eq(schema.killSheetImport.import_id, id));
      return this.detail(id, tenantId);
    });
  }

  async list(query: QueryKillSheetsDto, tenantId: string) {
    const s = this.scope(), page = Math.max(1, Number(query.page) || 1), limit = Math.min(100, Math.max(1, Number(query.limit) || 25)), search = query.search?.trim();
    const where = and(
      eq(schema.killSheetImport.tenant_id, tenantId),
      ...(s.companyId ? [eq(schema.killSheetImport.company_id, s.companyId)] : []),
      ...(s.farmId ? [eq(schema.killSheetImport.farm_id, s.farmId)] : []),
      ...(query.company_id ? [eq(schema.killSheetImport.company_id, query.company_id)] : []),
      ...(query.farm_id ? [eq(schema.killSheetImport.farm_id, query.farm_id)] : []),
      ...(query.status ? [eq(schema.killSheetImport.status, query.status)] : []),
      ...(search ? [or(
        like(schema.killSheetImport.report_reference, `%${search}%`),
        like(schema.killSheetImport.report_batch_reference, `%${search}%`),
        like(schema.batchHeader.batch_no, `%${search}%`),
        like(schema.locationMaster.location_name, `%${search}%`),
        sql`EXISTS (SELECT 1 FROM kill_sheet_carcass ksc WHERE ksc.import_id = ${schema.killSheetImport.import_id} AND ksc.ear_tag LIKE ${`%${search}%`})`
      )!] : [])
    );
    const rows = await this.db.select({
      item: schema.killSheetImport,
      farm_name: schema.locationMaster.location_name,
      farm_code: schema.locationMaster.location_code,
      batch_no: schema.batchHeader.batch_no,
      company_name: schema.companyMaster.company_name,
    })
      .from(schema.killSheetImport)
      .innerJoin(schema.locationMaster, eq(schema.locationMaster.location_id, schema.killSheetImport.farm_id))
      .innerJoin(schema.batchHeader, eq(schema.batchHeader.batch_id, schema.killSheetImport.batch_id))
      .innerJoin(schema.companyMaster, eq(schema.companyMaster.company_id, schema.killSheetImport.company_id))
      .where(where).orderBy(desc(schema.killSheetImport.created_at)).limit(limit).offset((page - 1) * limit);
    const [count] = await this.db.select({ count: sql<number>`count(*)` })
      .from(schema.killSheetImport)
      .innerJoin(schema.locationMaster, eq(schema.locationMaster.location_id, schema.killSheetImport.farm_id))
      .innerJoin(schema.batchHeader, eq(schema.batchHeader.batch_id, schema.killSheetImport.batch_id))
      .where(where);
    return {
      data: rows.map((row) => ({
        ...row.item,
        farm_name: row.farm_name,
        farm_code: row.farm_code,
        batch_no: row.batch_no,
        company_name: row.company_name,
      })),
      page,
      limit,
      total: Number(count.count),
    };
  }

  async detail(id: string, tenantId: string) {
    const item = await this.importFor(id, tenantId);
    const [carcasses] = await this.db.select({ count: sql<number>`count(*)` }).from(schema.killSheetCarcass).where(eq(schema.killSheetCarcass.import_id, id));
    const [products] = await this.db.select({ count: sql<number>`count(*)` }).from(schema.killSheetProduct).where(eq(schema.killSheetProduct.import_id, id));
    const [company] = await this.db.select({ company_name: schema.companyMaster.company_name, company_code: schema.companyMaster.company_code }).from(schema.companyMaster).where(eq(schema.companyMaster.company_id, item.company_id)).limit(1);
    const [farm] = await this.db.select({ farm_name: schema.locationMaster.location_name, farm_code: schema.locationMaster.location_code }).from(schema.locationMaster).where(eq(schema.locationMaster.location_id, item.farm_id)).limit(1);
    const [batch] = await this.db.select({ batch_no: schema.batchHeader.batch_no }).from(schema.batchHeader).where(eq(schema.batchHeader.batch_id, item.batch_id)).limit(1);

    const gradeRows = await this.db.select({
      grade: sql<string>`coalesce(${schema.killSheetCarcass.grade}, 'UNGRADED')`,
      count: sql<number>`count(*)`,
      warm_mass_kg: sql<number>`round(sum(${schema.killSheetCarcass.warm_mass_kg}), 2)`,
      cold_mass_kg: sql<number>`round(sum(${schema.killSheetCarcass.cold_mass_kg}), 2)`,
    }).from(schema.killSheetCarcass).where(eq(schema.killSheetCarcass.import_id, id)).groupBy(sql`coalesce(${schema.killSheetCarcass.grade}, 'UNGRADED')`).orderBy(sql`1`);

    const sexRows = await this.db.select({
      sex: sql<string>`coalesce(${schema.killSheetCarcass.sex}, 'UNKNOWN')`,
      count: sql<number>`count(*)`,
    }).from(schema.killSheetCarcass).where(eq(schema.killSheetCarcass.import_id, id)).groupBy(sql`coalesce(${schema.killSheetCarcass.sex}, 'UNKNOWN')`).orderBy(sql`1`);

    const sickRows = await this.db.select({
      sick_code: sql<string>`coalesce(${schema.killSheetCarcass.sick_code}, '0')`,
      count: sql<number>`count(*)`,
    }).from(schema.killSheetCarcass).where(eq(schema.killSheetCarcass.import_id, id)).groupBy(sql`coalesce(${schema.killSheetCarcass.sick_code}, '0')`).orderBy(sql`1`);

    const avgWeight = item.actual_animal_count && Number(item.actual_animal_count) > 0
      ? Number((Number(item.actual_cold_mass_kg) / Number(item.actual_animal_count)).toFixed(2))
      : null;

    return {
      ...item,
      company_name: company?.company_name ?? null,
      company_code: company?.company_code ?? null,
      farm_name: farm?.farm_name ?? null,
      farm_code: farm?.farm_code ?? null,
      batch_no: batch?.batch_no ?? null,
      carcass_count: Number(carcasses?.count ?? 0),
      product_count: Number(products?.count ?? 0),
      average_carcass_weight: avgWeight,
      distributions: {
        grades: gradeRows.map((r) => ({ grade: r.grade, count: Number(r.count), warm_mass_kg: Number(r.warm_mass_kg), cold_mass_kg: Number(r.cold_mass_kg) })),
        sexes: sexRows.map((r) => ({ sex: r.sex, count: Number(r.count) })),
        sick_codes: sickRows.map((r) => ({ sick_code: r.sick_code, count: Number(r.count) })),
      },
    };
  }
  async records(id: string, kind: 'carcasses' | 'products', query: QueryKillSheetsDto, tenantId: string) {
    await this.importFor(id, tenantId);
    const page = Math.max(1, Number(query.page) || 1), limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
    const search = query.search?.trim();
    if (kind === 'carcasses') {
      const where = and(
        eq(schema.killSheetCarcass.import_id, id),
        ...(search ? [or(like(schema.killSheetCarcass.ear_tag, `%${search}%`), like(schema.killSheetCarcass.grade, `%${search}%`))!] : []),
      );
      const data = await this.db.select().from(schema.killSheetCarcass)
        .where(where)
        .orderBy(asc(schema.killSheetCarcass.serial_number))
        .limit(limit)
        .offset((page - 1) * limit);
      const [count] = await this.db.select({ count: sql<number>`count(*)` })
        .from(schema.killSheetCarcass)
        .where(where);
      return { data, page, limit, total: Number(count.count) };
    }
    const where = and(
      eq(schema.killSheetProduct.import_id, id),
      ...(search ? [or(like(schema.killSheetProduct.category, `%${search}%`), like(schema.killSheetProduct.product_code, `%${search}%`), like(schema.killSheetProduct.description, `%${search}%`))!] : []),
    );
    const data = await this.db.select().from(schema.killSheetProduct)
      .where(where)
      .limit(limit)
      .offset((page - 1) * limit);
    const [count] = await this.db.select({ count: sql<number>`count(*)` })
      .from(schema.killSheetProduct)
      .where(where);
    return { data, page, limit, total: Number(count.count) };
  }
  async file(id: string, kind: KillSheetFileKind, tenantId: string) { const item = await this.importFor(id, tenantId), storageKey = kind === 'individual' ? item.individual_storage_key : item.summary_storage_key, name = kind === 'individual' ? item.individual_file_name : item.summary_file_name; if (!storageKey || !name) throw new NotFoundException('This Kill Sheet has no summary workbook.'); return { path: this.storage.path(storageKey), name }; }
}
