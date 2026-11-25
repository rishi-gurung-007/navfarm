import { and, eq } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { randomUUID } from 'crypto';
import * as schema from '../../../core/database/schema';
import { farmOfLocation } from '../../../common/farm-scope';
import type { NumberSeriesService } from '../../system/number-series/number-series.service';

type Db = MySql2Database<typeof schema>;

/** The next semen disposal number (SD-000001), from its own number series, created on first use. */
export async function nextDisposalNo(db: Db, numberSeries: NumberSeriesService, tenantId: string, companyId: string): Promise<string> {
  const seriesCode = await numberSeries.seriesCodeForDocument(
    tenantId,
    companyId,
    { seriesCode: 'SEMEN_DISPOSAL', seriesName: 'Semen Dose Disposal Number', documentType: 'SEMEN_DISPOSAL', prefix: 'SD', separator: '-', seqLength: 6 },
    async () =>
      (
        await db
          .select({ no: schema.semenDoseDisposal.disposal_no })
          .from(schema.semenDoseDisposal)
          .where(and(eq(schema.semenDoseDisposal.tenant_id, tenantId), eq(schema.semenDoseDisposal.company_id, companyId)))
      ).map((r) => r.no),
  );
  return numberSeries.generateNext(seriesCode, tenantId, companyId, db);
}

/**
 * A semen collection's QC rejected doses and they were scrapped: recorded as destroyed (source QC_REJECTION). They were never stock, so
 * nothing is written to the ledger and the lot's doses_destroyed is not touched (the inspection already took them off doses_collected).
 * Anything that is not a semen collection, or not scrapped, records nothing.
 */
export async function recordQcScrap(
  db: Db,
  numberSeries: NumberSeriesService,
  p: {
    inspection: { inspection_id: string; tenant_id: string; company_id: string; source_doc_type: string; source_line_id: string; lot_no: string | null; item_id: string; warehouse_id: string; inspection_no: string };
    disposition: string | null | undefined;
    doses: number;
    date: string;
    userId?: string | null;
  },
): Promise<void> {
  if (p.inspection.source_doc_type !== 'SEMEN_COLLECTION' || p.disposition !== 'SCRAP' || !(p.doses > 0)) return;
  const [lot] = await db
    .select({ id: schema.semenBatch.semen_batch_id })
    .from(schema.semenBatch)
    .where(eq(schema.semenBatch.semen_batch_id, p.inspection.source_line_id))
    .limit(1);
  if (!lot) return;
  const [already] = await db
    .select({ id: schema.semenDoseDisposal.disposal_id })
    .from(schema.semenDoseDisposal)
    .where(eq(schema.semenDoseDisposal.qc_inspection_id, p.inspection.inspection_id))
    .limit(1);
  if (already) return;
  await db.insert(schema.semenDoseDisposal).values({
    disposal_id: randomUUID(),
    tenant_id: p.inspection.tenant_id,
    company_id: p.inspection.company_id,
    disposal_no: await nextDisposalNo(db, numberSeries, p.inspection.tenant_id, p.inspection.company_id),
    semen_batch_id: lot.id,
    lot_no: p.inspection.lot_no,
    item_id: p.inspection.item_id,
    warehouse_id: p.inspection.warehouse_id,
    farm_id: await farmOfLocation(db, p.inspection.warehouse_id),
    doses: p.doses.toFixed(2),
    disposal_date: p.date,
    reason_type: 'QC_FAILED',
    source: 'QC_REJECTION',
    qc_inspection_id: p.inspection.inspection_id,
    remarks: `Rejected by QC inspection ${p.inspection.inspection_no} and scrapped.`,
    created_by: p.userId ?? null,
  });
}
