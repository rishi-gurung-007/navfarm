import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, eq } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { farmOfLocation } from '../../../common/farm-scope';
import { farmStoreOf } from '../../../common/farm-store';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { InventoryLedgerService } from '../../inventory/inventory-ledger/inventory-ledger.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { QrCodeService } from '../../production/qr-code/qr-code.service';

export interface PostedSemenLot {
  lot_no: string;
  expiry_date: string | null;
  warehouse_id: string;
  qr_id: string | null;
  pack_no: string | null;
}

/**
 * What a boar produces, held as stock. A collection that names an item is posted to inventory as a lot of that item
 * (any item the farm chooses for semen) in the boar's farm store, with a lot number from the ITEM_LOT series, an expiry
 * from the item's shelf life, and a lot-level QR carrying the boar, his batch and the lot's details. An AI mating that
 * names the lot then takes its doses out of that stock.
 *
 * Doses enter at no value: the cost per dose a collection records is information on the lot. Valuing farm-produced
 * stock is still open (decision 6).
 */
@Injectable()
export class SemenLotService {
  constructor(
    private readonly cls: ClsService,
    private readonly ledgerService: InventoryLedgerService,
    private readonly glPostingService: GlPostingService,
    private readonly numberSeriesService: NumberSeriesService,
    private readonly qrCodeService: QrCodeService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  async postCollection(
    params: {
      boar: typeof schema.animalRegister.$inferSelect;
      /** The other boars a pooled lot is mixed from (the collection's `boar` is the first of them). */
      poolBoars?: (typeof schema.animalRegister.$inferSelect)[];
      boarBatchId: string | null;
      semenBatchId: string;
      collectionDate: string;
      doses: number;
      itemId: string;
      /** Quality on the collection (G8), printed on the lot's QR. */
      quality?: { volume_ml: number | null; motility_pct: number | null; concentration_m_per_ml: number | null };
    },
    tenantId: string,
    userPayload?: { userId?: string },
  ): Promise<PostedSemenLot> {
    const { boar } = params;
    if (!(params.doses > 0)) throw new BadRequestException('A collection to post to inventory needs at least one dose.');

    const [item] = await this.db
      .select()
      .from(schema.itemMaster)
      .where(and(eq(schema.itemMaster.item_id, params.itemId), eq(schema.itemMaster.tenant_id, tenantId)))
      .limit(1);
    if (!item) throw new NotFoundException(`Semen item '${params.itemId}' not found.`);
    if (!item.is_active) throw new BadRequestException(`'${item.item_name}' is not active.`);

    const [boarBatch] = params.boarBatchId
      ? await this.db.select().from(schema.batchHeader).where(eq(schema.batchHeader.batch_id, params.boarBatchId)).limit(1)
      : [];

    // The semen is kept where the boar is: his batch's farm, else the farm of his pen.
    const farmId = boarBatch?.farm_id || (boar.current_location_id ? await farmOfLocation(this.db, boar.current_location_id) : null);
    const warehouseId = await farmStoreOf(this.db, farmId);
    if (!warehouseId) {
      throw new BadRequestException(`${boar.animal_code}'s farm has no store to hold the semen. Add a store, or record the collection without an item.`);
    }

    const lotNo = await this.numberSeriesService.generateNext('ITEM_LOT', tenantId, boar.company_id);
    let expiry: string | null = null;
    if (item.shelf_life_days) {
      const d = new Date(params.collectionDate);
      d.setDate(d.getDate() + item.shelf_life_days);
      expiry = d.toISOString().slice(0, 10);
    }

    const entry = await this.ledgerService.writePositiveEntry({
      tenantId,
      companyId: boar.company_id,
      itemId: item.item_id,
      documentType: 'BREEDING',
      documentNo: lotNo,
      documentLineId: params.semenBatchId,
      postingDate: params.collectionDate,
      transactionType: 'OUTPUT',
      quantity: params.doses,
      uom: item.uom_primary,
      rate: 0,
      lotNo,
      expiryDate: expiry ?? undefined,
      batchNo: boarBatch?.batch_no,
      warehouseId,
      userId: userPayload?.userId,
    });
    await this.glPostingService.postInventoryLedgerEntry(entry, userPayload?.userId);

    // The QR is a pack of its own, tied to a batch: a boar in no batch has none to print.
    const qr = boarBatch
      ? await this.qrCodeService.createForSemenLot(
          { boar, poolBoars: params.poolBoars, boarBatch, item, lotNo, collectionDate: params.collectionDate, doses: params.doses, expiryDate: expiry, warehouseId, quality: params.quality },
          tenantId,
          userPayload,
        )
      : null;

    return { lot_no: lotNo, expiry_date: expiry, warehouse_id: warehouseId, qr_id: qr?.qr_id ?? null, pack_no: qr?.pack_no ?? null };
  }

  /**
   * The doses an AI mating uses. They must exist: collected, less what is already used and sold. A lot posted to
   * inventory has them issued from its stock too; an older lot, collected before semen was stock, only has its count
   * moved.
   */
  async issueDoses(
    lot: typeof schema.semenBatch.$inferSelect,
    quantity: number,
    breedingId: string,
    matingDate: string,
    tenantId: string,
    userPayload?: { userId?: string },
  ) {
    const remaining = Number(lot.doses_collected) - Number(lot.doses_used_internal ?? 0) - Number(lot.doses_sold ?? 0);
    if (quantity > remaining + 1e-9) {
      throw new BadRequestException(
        `The semen lot${lot.lot_no ? ` ${lot.lot_no}` : ''} has ${remaining} dose${remaining === 1 ? '' : 's'} left; ${quantity} cannot be used.`,
      );
    }
    if (lot.inventory_posted && lot.output_item_id && lot.warehouse_id && lot.lot_no) {
      const [item] = await this.db
        .select({ uom_primary: schema.itemMaster.uom_primary })
        .from(schema.itemMaster)
        .where(eq(schema.itemMaster.item_id, lot.output_item_id))
        .limit(1);
      const issue = await this.ledgerService.writeNegativeEntry({
        tenantId,
        companyId: lot.company_id ?? '',
        itemId: lot.output_item_id,
        documentType: 'BREEDING',
        documentNo: breedingId,
        documentLineId: breedingId,
        postingDate: matingDate,
        transactionType: 'CONSUMPTION',
        quantity,
        uom: item?.uom_primary ?? 'DOSE',
        lotNo: lot.lot_no,
        warehouseId: lot.warehouse_id,
        userId: userPayload?.userId,
      });
      await this.glPostingService.postInventoryLedgerEntry(issue, userPayload?.userId);
    }
    await this.db
      .update(schema.semenBatch)
      .set({ doses_used_internal: String(Number(lot.doses_used_internal ?? 0) + quantity) })
      .where(eq(schema.semenBatch.semen_batch_id, lot.semen_batch_id));
  }
}
