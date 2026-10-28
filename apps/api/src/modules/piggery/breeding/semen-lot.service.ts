import { withTenantTransaction } from '../../../common/tenant-transaction';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { farmOfLocation } from '../../../common/farm-scope';
import { farmStoreOf } from '../../../common/farm-store';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { InventoryLedgerService } from '../../inventory/inventory-ledger/inventory-ledger.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { QrCodeService } from '../../production/qr-code/qr-code.service';
import { AnimalBookValueService } from '../../inventory/bio-asset-ledger/animal-book-value.service';
import { bioCodes } from '../../inventory/bio-asset-ledger/bio-asset-ledger.types';

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
 * Doses enter at the lot's cost per dose (the boar's amortisation, feed, drugs and overhead over the period, over the doses
 * collected), so the semen stock and its journal carry a value. An AI mating that uses them issues them at that cost and,
 * where the mating is of a sow in a bio-asset batch (and the BIO_SEMEN_USE / BIO_SEMEN_EXPENSE mapping is set up), charges the cost to the sow by the rule
 * her feed follows: while her costing has not begun it is added to her value (a Bio Asset Ledger row on her, and on her batch's carrying value) and handed on
 * to her litter with the rest of her capitalised cost at the farrowing; from the day it has begun it is expensed. Either way it is a consumption on her batch,
 * against her, which is how the batch and her card list what she consumed.
 */
@Injectable()
export class SemenLotService {
  constructor(
    private readonly cls: ClsService,
    private readonly ledgerService: InventoryLedgerService,
    private readonly glPostingService: GlPostingService,
    private readonly numberSeriesService: NumberSeriesService,
    private readonly qrCodeService: QrCodeService,
    private readonly animalBookValue: AnimalBookValueService,
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
      /** What one dose cost to produce (the collection's cost per dose); the doses enter stock at it. */
      unitCost?: number;
      /** Quality on the collection (G8), printed on the lot's QR. */
      quality?: { volume_ml: number | null; motility_pct: number | null; concentration_m_per_ml: number | null };
    },
    tenantId: string,
    userPayload?: { userId?: string },
  ) : Promise<PostedSemenLot> {
    // The number is drawn from the series inside this transaction, so a failure after it (a ledger or GL write, a bad
    // reference) rolls the counter back instead of burning the number. Joins the caller's transaction when one is open.
    return withTenantTransaction(this.cls, () => this.postCollectionRecord(params, tenantId, userPayload));
  }

  private async postCollectionRecord(
    params: {
      boar: typeof schema.animalRegister.$inferSelect;
      /** The other boars a pooled lot is mixed from (the collection's `boar` is the first of them). */
      poolBoars?: (typeof schema.animalRegister.$inferSelect)[];
      boarBatchId: string | null;
      semenBatchId: string;
      collectionDate: string;
      doses: number;
      itemId: string;
      unitCost?: number;
      /** Quality on the collection (G8), printed on the lot's QR. */
      quality?: { volume_ml: number | null; motility_pct: number | null; concentration_m_per_ml: number | null };
    },
    tenantId: string,
    userPayload?: { userId?: string },
  ) : Promise<PostedSemenLot> {
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

    // The doses are stock at the cost of producing them. The boar's costs were booked as expense (or into his own asset), never into work in progress, so the
    // stock is credited to the recovery account (BIO_SEMEN_PRODUCTION), not to WIP; without that mapping it is posted the ordinary way, as an output.
    const recoveryMapped = (params.unitCost ?? 0) > 0 && (await this.glPostingService.hasMapping(tenantId, boar.company_id, 'BIO_SEMEN_PRODUCTION'));
    const entry = await this.ledgerService.writePositiveEntry({
      tenantId,
      companyId: boar.company_id,
      itemId: item.item_id,
      glMappingType: recoveryMapped ? 'BIO_SEMEN_PRODUCTION' : undefined,
      documentType: 'BREEDING',
      documentNo: lotNo,
      documentLineId: params.semenBatchId,
      postingDate: params.collectionDate,
      transactionType: 'OUTPUT',
      quantity: params.doses,
      uom: item.uom_primary,
      rate: Number((params.unitCost ?? 0).toFixed(6)),
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
   *
   * `use` says whose mating it is. The issue is then filed under the sow's batch and named for her (AI <sow code>), and its
   * cost is charged to her (see `chargeSow`). Without it the doses are issued as before, against the mating's id alone.
   */
  async issueDoses(
    lot: typeof schema.semenBatch.$inferSelect,
    quantity: number,
    breedingId: string,
    matingDate: string,
    tenantId: string,
    userPayload?: { userId?: string },
    use?: { sow: typeof schema.animalRegister.$inferSelect; batchId: string | null },
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

      // The doses cost what THIS lot cost, whatever else is in the store: they are drawn from the lot's own receipt layer. Where that layer no longer holds them
      // (some of the stock was transferred away) they are drawn the ordinary way, from the oldest receipt.
      const [lotReceipt] = await this.db
        .select({ ledger_id: schema.inventoryLedger.ledger_id, remaining_quantity: schema.inventoryLedger.remaining_quantity })
        .from(schema.inventoryLedger)
        .where(and(
          eq(schema.inventoryLedger.item_id, lot.output_item_id),
          eq(schema.inventoryLedger.warehouse_id, lot.warehouse_id),
          eq(schema.inventoryLedger.lot_no, lot.lot_no),
          eq(schema.inventoryLedger.transaction_type, 'OUTPUT'),
          eq(schema.inventoryLedger.document_type, 'BREEDING'),
        ))
        .limit(1);
      const sourceLedgerId = lotReceipt && Number(lotReceipt.remaining_quantity ?? 0) >= quantity - 1e-9 ? lotReceipt.ledger_id : undefined;

      // The sow's batch, when the cost can go onto her: a bio-asset batch with a carrying value.
      const [sowBatch] = use?.batchId
        ? await this.db.select().from(schema.batchHeader).where(eq(schema.batchHeader.batch_id, use.batchId)).limit(1)
        : [];
      const [batchState] = sowBatch
        ? await this.db.select().from(schema.batchBioAssetState).where(eq(schema.batchBioAssetState.batch_id, sowBatch.batch_id)).limit(1)
        : [];
      // The rule her feed follows: capitalised into her while her batch is pre-mature and her costing has not begun, expensed from the day it has.
      // The GL rule is picked by it; without that rule's mapping the doses are issued by the ordinary consumption mapping and nothing is put on her.
      let charge: 'CAPITALISE' | 'EXPENSE' | null = null;
      let glMappingType: string | undefined;
      if (use && sowBatch && sowBatch.costing_method === 'BIO_ASSET' && batchState) {
        const costingBegun = !!use.sow.costing_start_date && String(use.sow.costing_start_date).slice(0, 10) <= matingDate;
        const wanted = batchState.stage === 'PREMATURE' && !costingBegun ? 'BIO_SEMEN_USE' : 'BIO_SEMEN_EXPENSE';
        if (await this.glPostingService.hasMapping(tenantId, lot.company_id ?? '', wanted, { nobId: sowBatch.nob_id, lobId: sowBatch.lob_id })) {
          charge = wanted === 'BIO_SEMEN_USE' ? 'CAPITALISE' : 'EXPENSE';
          glMappingType = wanted;
        }
      }

      const issue = await this.ledgerService.writeNegativeEntry({
        tenantId,
        companyId: lot.company_id ?? '',
        itemId: lot.output_item_id,
        documentType: 'BREEDING',
        documentNo: use ? `AI ${use.sow.animal_code}` : breedingId,
        documentLineId: breedingId,
        postingDate: matingDate,
        transactionType: 'CONSUMPTION',
        glMappingType,
        quantity,
        uom: item?.uom_primary ?? 'DOSE',
        lotNo: lot.lot_no,
        sourceLedgerId,
        batchNo: sowBatch?.batch_no,
        warehouseId: lot.warehouse_id,
        userId: userPayload?.userId,
      });
      // Capitalised into the sow: out of the stock, into the class account she is carried in.
      const sowAccount = charge === 'CAPITALISE' ? await this.glPostingService.animalAssetAccountId(use!.sow.animal_id) : undefined;
      await this.glPostingService.postInventoryLedgerEntry(issue, userPayload?.userId, sowAccount ? { debitAccountId: sowAccount } : {});
      const cost = Math.abs(Number(issue.amount ?? 0));
      if (charge && cost >= 0.005) {
        await this.chargeSow({ lot, use: use!, batch: sowBatch!, ledgerId: issue.ledger_id, quantity, cost, breedingId, matingDate, uom: item?.uom_primary ?? 'DOSE', capitalise: charge === 'CAPITALISE' }, tenantId, userPayload);
      }
    }
    await this.db
      .update(schema.semenBatch)
      .set({ doses_used_internal: String(Number(lot.doses_used_internal ?? 0) + quantity) })
      .where(eq(schema.semenBatch.semen_batch_id, lot.semen_batch_id));
  }

  /**
   * The cost of the semen a mating used, onto the sow: a Bio Asset Ledger row on her (semen used, capitalised, so it is part of what she is worth and of
   * the cost her litter takes from her at the farrowing), the same amount on her batch's carrying value, and a consumption on the batch against her, which
   * is how the batch and her card list what she consumed.
   */
  private async chargeSow(
    p: {
      lot: typeof schema.semenBatch.$inferSelect;
      use: { sow: typeof schema.animalRegister.$inferSelect; batchId: string | null };
      batch: typeof schema.batchHeader.$inferSelect;
      ledgerId: string;
      quantity: number;
      cost: number;
      breedingId: string;
      matingDate: string;
      uom: string;
      /** Capitalised into the sow (her costing has not begun), or expensed (it has, as her feed is). */
      capitalise: boolean;
    },
    tenantId: string,
    userPayload?: { userId?: string },
  ) {
    const { lot, use, batch } = p;
    const perDose = p.cost / p.quantity;
    if (p.capitalise) {
      await this.db.insert(schema.bioAssetLedger).values({
        entry_id: randomUUID(),
        tenant_id: tenantId,
        company_id: batch.company_id,
        bio_asset_item_id: use.sow.item_id ?? lot.output_item_id!,
        animal_id: use.sow.animal_id,
        ...bioCodes.semen(),
        document_no: lot.lot_no,
        // The mating, so the row can be found from it.
        document_line_id: p.breedingId,
        batch_id: batch.batch_id,
        batch_no: batch.batch_no,
        lot_no: lot.lot_no,
        posting_date: p.matingDate,
        stage: 'PREMATURE',
        uom: p.uom,
        quantity: p.quantity.toString(),
        cost_amount: p.cost.toFixed(4),
        cost_amount_each_unit: perDose.toFixed(4),
        costing_method: 'COST_ACCUMULATION',
        nob_id: batch.nob_id,
        lob_id: batch.lob_id,
        created_by: userPayload?.userId || null,
      });
      const [state] = await this.db.select().from(schema.batchBioAssetState).where(eq(schema.batchBioAssetState.batch_id, batch.batch_id)).limit(1);
      if (state) {
        await this.db
          .update(schema.batchBioAssetState)
          .set({ nca_book_value: (Number(state.nca_book_value) + p.cost).toFixed(4) })
          .where(eq(schema.batchBioAssetState.batch_id, batch.batch_id));
      }
    }
    await this.db.insert(schema.batchTransaction).values({
      transaction_id: randomUUID(),
      batch_id: batch.batch_id,
      transaction_date: p.matingDate,
      transaction_type: 'CONSUMPTION',
      item_id: lot.output_item_id!,
      quantity: p.quantity.toString(),
      uom: p.uom,
      rate: perDose.toFixed(6),
      // Consumption is stored as an outflow, as the feed is.
      amount: (-p.cost).toFixed(4),
      remarks: `Semen lot ${lot.lot_no} used at the mating of ${use.sow.animal_code}`,
      ledger_id: p.ledgerId,
      animal_id: use.sow.animal_id,
      created_by: userPayload?.userId || null,
    });
    if (p.capitalise) await this.animalBookValue.refreshCache([use.sow.animal_id]);
  }
}
