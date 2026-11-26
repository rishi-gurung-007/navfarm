import { Injectable } from '@nestjs/common';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import type * as schema from '../../../core/database/schema';

type Db = MySql2Database<typeof schema>;

/** An inspection as the source document that raised it sees it once it settles. */
export interface QcSettledInspection {
  inspection_id: string;
  inspection_no: string;
  tenant_id: string;
  company_id: string;
  source_doc_type: string;
  source_line_id: string;
  item_id: string;
  warehouse_id: string;
  lot_no: string | null;
  /** The quantity that was inspected. */
  quantity: string;
}

/**
 * What a source document does when its inspection settles, beyond the ledger entry the inspection writes for it. The QC module is
 * generic — goods receipts, transfer receipts and semen collections all raise inspections — so it does not know any source's own
 * tables. A source that keeps state of its own registers a handler for its source_doc_type (from its own module, which already
 * depends on this one) and is told here. Before 26 Nov the QC service imported the semen disposal record and wrote semen_batch and
 * the semen QR pack itself, so inventory depended on piggery.
 */
export interface QcSourceHandler {
  /** The inspection closed: `acceptedQty` of the inspected quantity was accepted, and `posted` says whether it is now stock. */
  settled?(db: Db, inspection: QcSettledInspection, acceptedQty: number, posted: boolean): Promise<void>;
  /** `quantity` the inspection rejected was scrapped, dated `date`. Called once per scrap and only for a positive quantity. */
  scrapped?(db: Db, p: { inspection: QcSettledInspection; quantity: number; date: string; userId?: string | null }): Promise<void>;
}

/** The handlers source documents register, by source_doc_type. One handler per source. */
@Injectable()
export class QcSourceHandlers {
  private readonly handlers = new Map<string, QcSourceHandler>();

  register(sourceDocType: string, handler: QcSourceHandler): void {
    const existing = this.handlers.get(sourceDocType);
    if (existing && existing !== handler) {
      throw new Error(`A QC source handler for ${sourceDocType} is already registered.`);
    }
    this.handlers.set(sourceDocType, handler);
  }

  async settled(db: Db, inspection: QcSettledInspection, acceptedQty: number, posted: boolean): Promise<void> {
    await this.handlers.get(inspection.source_doc_type)?.settled?.(db, inspection, acceptedQty, posted);
  }

  async scrapped(db: Db, p: { inspection: QcSettledInspection; quantity: number; date: string; userId?: string | null }): Promise<void> {
    if (!(p.quantity > 0)) return;
    await this.handlers.get(p.inspection.source_doc_type)?.scrapped?.(db, p);
  }
}
