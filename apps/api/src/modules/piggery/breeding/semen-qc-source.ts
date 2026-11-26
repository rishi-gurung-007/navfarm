import { Injectable, OnModuleInit } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../../../core/database/schema';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { QcSourceHandlers, type QcSettledInspection, type QcSourceHandler } from '../../inventory/qc-inspection/qc-source-handlers';
import { recordQcScrap } from './semen-disposal.record';

type Db = MySql2Database<typeof schema>;

/**
 * What a semen collection does when its QC inspection settles (source SEMEN_COLLECTION). It lived inside the generic QC service until
 * 26 Nov; it is registered from here so the QC module does not depend on piggery.
 */
@Injectable()
export class SemenQcSource implements QcSourceHandler, OnModuleInit {
  constructor(
    private readonly handlers: QcSourceHandlers,
    private readonly numberSeries: NumberSeriesService,
  ) {}

  onModuleInit() {
    this.handlers.register('SEMEN_COLLECTION', this);
  }

  /**
   * A semen lot is held as stock only once its inspection has put it there; a lot that passed only in part has only the accepted doses
   * to use, and one that failed has none. Its QR pack follows what QC accepted and names the inspection (Traceability's QC link).
   */
  async settled(db: Db, inspection: QcSettledInspection, acceptedQty: number, posted: boolean): Promise<void> {
    const collected = Number(inspection.quantity);
    const partly = acceptedQty + 1e-9 < collected;
    const note = partly ? `QC ${inspection.inspection_no}: ${acceptedQty} of ${collected} doses accepted.` : null;
    await db
      .update(schema.semenBatch)
      .set({
        inventory_posted: posted,
        ...(partly ? { doses_collected: String(acceptedQty) } : {}),
        ...(note ? { notes: sql`concat(coalesce(${schema.semenBatch.notes}, ''), ${note}, ' ')` } : {}),
      })
      .where(eq(schema.semenBatch.semen_batch_id, inspection.source_line_id));
    if (inspection.lot_no) {
      const result = !posted ? 'Rejected' : partly ? 'Partly accepted' : 'Accepted';
      await db
        .update(schema.qrCodeMaster)
        .set({
          net_weight: String(acceptedQty),
          qr_data: sql`json_set(${schema.qrCodeMaster.qr_data}, '$.doses', ${acceptedQty}, '$.qc_inspection', json_object('inspection_no', ${inspection.inspection_no}, 'result', ${result}, 'accepted', ${acceptedQty}, 'collected', ${collected}))`,
        })
        .where(and(eq(schema.qrCodeMaster.tenant_id, inspection.tenant_id), eq(schema.qrCodeMaster.lot_no, inspection.lot_no), eq(schema.qrCodeMaster.pack_uom, 'DOSE')));
    }
  }

  /** Doses the collection's QC rejected and scrapped are recorded as destroyed (the AI Station report). */
  async scrapped(db: Db, p: { inspection: QcSettledInspection; quantity: number; date: string; userId?: string | null }): Promise<void> {
    await recordQcScrap(db, this.numberSeries, { inspection: p.inspection, disposition: 'SCRAP', doses: p.quantity, date: p.date, userId: p.userId });
  }
}
