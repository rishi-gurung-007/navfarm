import { withTenantTransaction } from '../../../common/tenant-transaction';
import { Injectable, BadRequestException, NotFoundException, Optional } from '@nestjs/common';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, or, isNull, gte, lte, lt, inArray, asc, desc, sql, isNotNull, ne, like, getTableColumns, SQL } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { LedgerExportRow, LEDGER_EXPORT_MAX_ROWS } from './inventory-ledger-export';
import { alias } from 'drizzle-orm/mysql-core';
import { QueryInventoryLedgerDto, QueryStockBalanceDto, QueryAvailableLotsDto, QueryAvailableSerialsDto } from './dto/inventory-ledger.dto';
import { parseSerials } from './serial-utils';
import { lotBalances, serialsInStock } from './lot-balance';
import { costingMethodOf, explainCosting, type ExplainBookReceipt } from './costing-explanation';
import { farmScope, locationOnFarm, locationReferenceScopeConditions, restrictedScopeConditions } from '../../../common/farm-scope';

interface WritePositiveEntryParams {
  tenantId: string;
  companyId: string;
  itemId: string;
  documentType: string;
  documentNo: string;
  documentLineId?: string;
  postingDate: string;
  externalReferenceNo?: string;
  transactionType: string;
  entryType?: string;
  quantity: number;
  uom: string;
  rate?: number;
  lotNo?: string;
  serialNo?: string;
  expiryDate?: string;
  batchNo?: string;
  warehouseId?: string;
  locationId?: string;
  userId?: string;
}

interface WriteNegativeEntryParams {
  tenantId: string;
  companyId: string;
  itemId: string;
  documentType: string;
  documentNo: string;
  documentLineId?: string;
  postingDate: string;
  externalReferenceNo?: string;
  transactionType: string;
  entryType?: string;
  quantity: number; // positive number — the amount being consumed/shipped/written off
  uom: string;
  lotNo?: string;
  /**
   * Stock issued from several lots in one entry: the entry carries the whole quantity and one ledger line
   * per lot says where it physically came out. Mutually exclusive with `lotNo` (a single lot, named on the entry).
   */
  lots?: Array<{ lotNo: string; quantity: number }>;
  serialNo?: string;
  batchNo?: string;
  warehouseId?: string;
  locationId?: string;
  userId?: string;
}

/** A silo or store's signed stock of one item and unit, summed (Feed Forecast Plan R). */
export interface FeedStockRow {
  warehouse_id: string;
  item_id: string;
  item_code: string;
  uom: string;
  qty: number;
}

/** The same, for one posting date. */
export interface FeedStockMovement extends FeedStockRow {
  posting_date: string;
}

/** Money is kept to 4 decimal places, the scale of the amount columns. */
const roundMoney = (value: number) => Number(value.toFixed(4));

/**
 * Shared posting engine for the Inventory Ledger — the append-only movement
 * log every document type (GRN, Transfer Order, Stock
 * Adjustment) writes to. Ledger rows are never updated, only inserted.
 */
@Injectable()
export class InventoryLedgerService {
  constructor(
    private readonly cls: ClsService,
    @Optional() private readonly numberSeriesService?: NumberSeriesService,
  ) { }

  private async generateApplicationId(
    tenantId: string,
    companyId?: string | null,
    executor?: MySql2Database<typeof schema>,
  ): Promise<string> {
    if (this.numberSeriesService) {
      try {
        return await this.numberSeriesService.generateNext(
          'ITEM_APPLICATION',
          tenantId,
          companyId,
          executor,
        );
      } catch {
        // Fall through to query fallback
      }
    }
    const db = executor || this.db;
    try {
      const [{ maxId }] = await db
        .select({
          maxId: sql<string>`MAX(${schema.inventoryApplication.application_id})`,
        })
        .from(schema.inventoryApplication)
        .where(
          and(
            eq(schema.inventoryApplication.tenant_id, tenantId),
            like(schema.inventoryApplication.application_id, 'APP-%'),
          ),
        );
      const seqMatch = maxId ? maxId.match(/APP-(\d+)/) : null;
      const nextSeq = seqMatch ? parseInt(seqMatch[1], 10) + 1 : 1;
      return `APP-${String(nextSeq).padStart(5, '0')}`;
    } catch {
      return `APP-${randomUUID().slice(0, 8).toUpperCase()}`;
    }
  }

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  /** Reverse an issue at its original cost and restore exactly the layers it drew.
   * The positive reversal is not a new FIFO layer: the old layers regain stock.
   * external_reference_no links the reversal to the original ledger UUID.
   */
  async reverseEntry(ledgerId: string, tenantId: string, userId?: string) {
    return withTenantTransaction(this.cls, async () => {
      const [original] = await this.db.select().from(schema.inventoryLedger)
        .where(and(eq(schema.inventoryLedger.ledger_id, ledgerId), eq(schema.inventoryLedger.tenant_id, tenantId)))
        .for('update');
      if (!original || original.entry_type !== 'NEGATIVE') throw new BadRequestException('Only an existing issue can be reversed here.');
      const [reversed] = await this.db.select().from(schema.inventoryLedger)
        .where(and(eq(schema.inventoryLedger.external_reference_no, ledgerId), eq(schema.inventoryLedger.transaction_type, 'REVERSAL'))).limit(1);
      if (reversed) throw new BadRequestException('This issue has already been reversed.');
      const applications = await this.db.select().from(schema.inventoryApplication)
        .where(eq(schema.inventoryApplication.outbound_ledger_id, ledgerId));
      const appliedQty = applications.reduce((sum, a) => sum + Number(a.applied_qty), 0);
      if (Math.abs(appliedQty + Number(original.quantity)) > 0.0001) throw new BadRequestException('The issue has incomplete FIFO applications; review before reversing.');
      const reversalId = randomUUID();
      // No explicit created_at here — every other ledger write (writePositiveEntry,
      // writeNegativeEntry, applyFifo) leaves it to inventory_ledger.created_at's
      // own DEFAULT (local server time). This insert used to compute
      // `new Date().toISOString()...`, which is UTC, so a same-day reversal could
      // sort *before* the entry it reverses once the server's local offset was
      // applied to every other row's timestamp. Letting the column default apply
      // keeps every write on the same clock.
      //
      // `...original` is destructured to drop its own created_at first — spreading
      // the original row as-is would otherwise carry the *original entry's*
      // timestamp onto the reversal (the row being spread already has a real
      // value, so `undefined` never comes into it), which is wrong in a different
      // way: the reversal would appear to have been written back when the
      // original was, not now.
      // entry_no is dropped for the same reason: the reversal is a new entry and the trigger numbers it.
      const { created_at: _originalCreatedAt, entry_no: _originalEntryNo, ...originalForReversal } = original;
      await this.db.insert(schema.inventoryLedger).values({
        ...originalForReversal, ledger_id: reversalId, entry_type: 'POSITIVE', transaction_type: 'REVERSAL',
        quantity: (-Number(original.quantity)).toString(), amount: (-Number(original.amount)).toString(),
        remaining_quantity: '0', external_reference_no: ledgerId,
        created_by: userId || null,
      });
      for (const application of applications) {
        await this.db.update(schema.inventoryLedger)
          .set({ remaining_quantity: sql`${schema.inventoryLedger.remaining_quantity} + ${application.applied_qty}` })
          .where(eq(schema.inventoryLedger.ledger_id, application.inbound_ledger_id));
        const { created_at: _appCreatedAt, inbound_entry_no: _inNo, outbound_entry_no: _outNo, ...applicationForReversal } = application;
        const revAppId = await this.generateApplicationId(
          original.tenant_id,
          original.company_id,
          this.db,
        );
        await this.db.insert(schema.inventoryApplication).values({
          ...applicationForReversal, application_id: revAppId, outbound_ledger_id: reversalId,
          applied_qty: (-Number(application.applied_qty)).toString(),
          applied_cost_amount: (-Number(application.applied_cost_amount)).toString(),
          created_by: userId || null,
        });
      }
      // The lots the issue took stock from get that stock back: opposite lines.
      const lines = await this.db.select().from(schema.inventoryLedgerLine).where(eq(schema.inventoryLedgerLine.ledger_id, ledgerId));
      if (lines.length) {
        await this.db.insert(schema.inventoryLedgerLine).values(
          lines.map((line) => ({
            tenant_id: line.tenant_id,
            company_id: line.company_id,
            ledger_id: reversalId,
            line_no: line.line_no,
            item_id: line.item_id,
            warehouse_id: line.warehouse_id,
            lot_no: line.lot_no,
            serial_no: line.serial_no,
            quantity: (-Number(line.quantity)).toString(),
            expiry_date: line.expiry_date,
          })),
        );
      }
      return this.loadOne(reversalId);
    });
  }

  /**
   * item_master.is_lot_tracked/is_serial_tracked (TDD row 11's three-way
   * choice: LOT, SERIAL, or neither) says whether a movement of this item
   * must carry that identity. Shared by every ledger write — receipt, issue,
   * and both legs of a transfer — so a lot/serial-tracked item can't post
   * anywhere without one, the same way goods_receipt_line already required it
   * in practice even though nothing enforced it.
   */
  private assertTracking(item: typeof schema.itemMaster.$inferSelect, lotNo?: string, serialNo?: string, lots?: unknown[]) {
    if (item.is_lot_tracked && !lotNo && !(lots && lots.length)) {
      throw new BadRequestException(`Item '${item.item_code}' is lot-tracked — a Lot No. is required.`);
    }
    if (item.is_serial_tracked && !serialNo) {
      throw new BadRequestException(`Item '${item.item_code}' is serial-tracked — a Serial No. is required.`);
    }
  }

  /** Writes a POSITIVE (inbound) ledger entry — Goods Receipt lines, and positive Stock Adjustment lines. */
  async writePositiveEntry(params: WritePositiveEntryParams) {
    const [item] = await this.db
      .select()
      .from(schema.itemMaster)
      .where(eq(schema.itemMaster.item_id, params.itemId))
      .limit(1);

    if (!item) {
      throw new BadRequestException(`Item with ID '${params.itemId}' not found.`);
    }
    this.assertTracking(item, params.lotNo, params.serialNo);

    const rate = params.rate ?? 0;
    const ledgerId = randomUUID();

    await this.db.insert(schema.inventoryLedger).values({
      ledger_id: ledgerId,
      tenant_id: params.tenantId,
      company_id: params.companyId,
      item_id: params.itemId,
      item_code: item.item_code,
      item_description: item.item_name,
      document_type: params.documentType,
      document_no: params.documentNo,
      document_line_id: params.documentLineId || null,
      posting_date: params.postingDate,
      external_reference_no: params.externalReferenceNo || null,
      entry_type: params.entryType || 'POSITIVE',
      transaction_type: params.transactionType,
      quantity: params.quantity.toString(),
      remaining_quantity: params.quantity.toString(),
      uom: params.uom,
      uom_conversion_factor: item.uom_conversion_factor,
      rate: rate.toString(),
      amount: (params.quantity * rate).toString(),
      lot_no: params.lotNo || null,
      serial_no: params.serialNo || null,
      expiry_date: params.expiryDate || null,
      batch_no: params.batchNo || null,
      location_id: params.locationId || null,
      warehouse_id: params.warehouseId || null,
      nob_id: item.nob_id,
      lob_id: item.lob_id,
      category_id: item.category_id,
      created_by: params.userId || null,
    });

    return this.loadOne(ledgerId);
  }

  /**
   * Costs and draws an outbound quantity. Two separate things happen:
   *
   *   COST — which receipts the quantity is applied to, and at what price, follows the ITEM'S COSTING METHOD,
   *   never the lot or serial picked: FIFO draws the oldest receipts at the location first at their own price;
   *   AVERAGE prices the draw at the average of what is left; STANDARD at the item's standard cost. Each draw
   *   is recorded as an application against the receipt it used, which is the "consumed entry" the ledger
   *   shows, and lowers that receipt's remaining quantity.
   *
   *   IDENTITY — which lots or serials the stock physically leaves is the user's choice, checked against what
   *   each lot or serial holds (lot-balance.ts) and recorded on the entry (one lot) or on its ledger lines
   *   (several). It does not move cost: a lot picked for its expiry can be costed from an older receipt.
   *
   * Called inside the outbound row's own transaction. Receipt layers at the location are locked first, so two
   * concurrent consumptions queue instead of both reading the same remaining quantity. Returns the entry's
   * total cost and the location the stock actually came from.
   */
  async applyFifo(
    params: {
      tenantId: string;
      companyId: string;
      itemId: string;
      outboundLedgerId: string;
      quantity: number;
      lotNo?: string;
      lots?: Array<{ lotNo: string; quantity: number }>;
      serialNo?: string;
      applicationDate: string;
      userId?: string;
      // Batch consumption draws from a company-wide pool and never sets this
      // (see batch.service.ts) — left undefined there preserves that existing
      // behavior. Every warehouse-based document (GRN, Transfer Order,
      // Stock Adjustment) always supplies it, which scopes the draw to
      // layers actually received into that warehouse instead of drawing down
      // whichever warehouse happens to hold the oldest layer tenant-wide.
      warehouseId?: string;
    },
    executor: MySql2Database<typeof schema> = this.db
  ): Promise<{ totalCost: number; averageRate: number; appliedWarehouseId?: string; lotExpiry?: Map<string, string | null> }> {
    // A zero/negative quantity would make the loop below no-op immediately
    // (remainingToConsume <= 0 on the first check) and the insufficient-stock
    // guard after it never fires either (0/negative is never > 0) — silently
    // skipping the draw instead of rejecting the request.
    if (params.quantity <= 0) {
      throw new BadRequestException(`Consumption quantity must be positive (got ${params.quantity}).`);
    }
    const serials = parseSerials(params.serialNo);
    const lots = params.lots ?? (params.lotNo ? [{ lotNo: params.lotNo, quantity: params.quantity }] : []);
    if (params.lots && Math.abs(params.lots.reduce((n, l) => n + l.quantity, 0) - params.quantity) > 0.0001) {
      throw new BadRequestException(`The lots add up to ${params.lots.reduce((n, l) => n + l.quantity, 0)} but the quantity is ${params.quantity}; they must match.`);
    }
    if (serials.length > 0) {
      if (new Set(serials).size !== serials.length) {
        throw new BadRequestException(`A serial number is listed twice: ${serials.filter((x, i) => serials.indexOf(x) !== i).join(', ')}.`);
      }
      if (Math.abs(params.quantity - serials.length) > 0.0001) {
        throw new BadRequestException(`${serials.length} serial number(s) selected but the quantity is ${params.quantity}; they must match.`);
      }
    }

    const [item] = await executor
      .select({ valuation_method: schema.itemMaster.valuation_method, standard_cost: schema.itemMaster.standard_cost })
      .from(schema.itemMaster)
      .where(eq(schema.itemMaster.item_id, params.itemId))
      .limit(1);

    // Serials are issued from where they are: the requested location when it holds them all, otherwise the
    // one location that does. The cost layers below are then that location's.
    let warehouseId = params.warehouseId;
    if (serials.length > 0) warehouseId = await this.locateSerials(params, serials, executor);

    const layerConditions = [
      eq(schema.inventoryLedger.tenant_id, params.tenantId),
      eq(schema.inventoryLedger.company_id, params.companyId),
      eq(schema.inventoryLedger.item_id, params.itemId),
      inArray(schema.inventoryLedger.entry_type, ['POSITIVE', 'TRANSFER']),
    ];
    if (warehouseId) layerConditions.push(eq(schema.inventoryLedger.warehouse_id, warehouseId));
    // Oldest first: posting date, then Entry No. - created_at is only second-precise, so two receipts
    // posted together tied on it and the newer one could be drawn first.
    const availableLayers = await executor
      .select()
      .from(schema.inventoryLedger)
      .where(and(...layerConditions))
      .orderBy(asc(schema.inventoryLedger.posting_date), asc(schema.inventoryLedger.entry_no))
      .for('update');

    // Lots: what each holds, now that the layers are locked and no other posting can move it.
    let lotExpiry: Map<string, string | null> | undefined;
    if (lots.length > 0) {
      const held = await lotBalances(executor, { tenantId: params.tenantId, companyId: params.companyId, itemId: params.itemId, warehouseId, lotNos: lots.map((l) => l.lotNo), excludeLedgerId: params.outboundLedgerId });
      lotExpiry = new Map(held.map((h) => [h.lot_no, h.expiry_date]));
      for (const lot of lots) {
        const have = held.find((h) => h.lot_no === lot.lotNo)?.quantity ?? 0;
        if (have + 0.0001 < lot.quantity) {
          throw new BadRequestException(await this.shortageMessage({ ...params, quantity: lot.quantity, lotNo: lot.lotNo, warehouseId }, Math.max(0, have), lot.quantity - Math.max(0, have), executor));
        }
      }
    }

    // What the item's costing method prices each unit at.
    const method = String(item?.valuation_method ?? 'FIFO').toUpperCase();
    const standard = item?.standard_cost != null ? Number(item.standard_cost) : null;
    let fixedRate: number | null = null; // FIFO (and anything else): each receipt at its own price
    if (method === 'STANDARD' && standard != null) fixedRate = standard;
    else if (method === 'AVG' || method === 'AVERAGE') {
      // Moving average: the book value of the stock over its book quantity, from the signed ledger, so a
      // draw never shifts the average. With no book quantity left (stock never costed) fall back to the receipts' own prices.
      const book = await this.bookBalance(executor, { tenantId: params.tenantId, companyId: params.companyId, itemId: params.itemId, warehouseId, excludeLedgerId: params.outboundLedgerId });
      fixedRate = book.quantity > 0.00005 ? book.value / book.quantity : null;
    }

    let remainingToConsume = params.quantity;
    let totalCost = 0;
    const draws: Array<{ layer: (typeof availableLayers)[number]; qty: number; cost: number }> = [];
    for (const layer of availableLayers) {
      if (remainingToConsume <= 0) break;
      const layerRemaining = Number(layer.remaining_quantity || 0);
      if (layerRemaining <= 0) continue;
      const drawQty = Math.min(layerRemaining, remainingToConsume);
      const cost = fixedRate == null ? await this.layerDrawCost(layer, drawQty, layerRemaining, executor) : roundMoney(drawQty * fixedRate);
      draws.push({ layer, qty: drawQty, cost });
      remainingToConsume -= drawQty;
    }
    if (remainingToConsume > 0.00005) {
      throw new BadRequestException(await this.shortageMessage({ ...params, warehouseId }, params.quantity - remainingToConsume, remainingToConsume, executor));
    }
    if (fixedRate != null && draws.length > 0) {
      // Per-draw rounding must not move the entry's total off quantity x rate.
      const exact = roundMoney(params.quantity * fixedRate);
      const drift = roundMoney(exact - draws.reduce((n, d) => n + d.cost, 0));
      draws[draws.length - 1].cost = roundMoney(draws[draws.length - 1].cost + drift);
    }
    for (const { layer, qty, cost } of draws) {
      await executor.insert(schema.inventoryApplication).values({
        application_id: await this.generateApplicationId(params.tenantId, params.companyId, executor),
        tenant_id: params.tenantId,
        company_id: params.companyId,
        item_id: params.itemId,
        inbound_ledger_id: layer.ledger_id,
        outbound_ledger_id: params.outboundLedgerId,
        applied_qty: qty.toString(),
        applied_cost_amount: cost.toString(),
        application_date: params.applicationDate,
        created_by: params.userId || null,
      });
      await executor
        .update(schema.inventoryLedger)
        .set({ remaining_quantity: (Number(layer.remaining_quantity || 0) - qty).toString() })
        .where(eq(schema.inventoryLedger.ledger_id, layer.ledger_id));
      totalCost = roundMoney(totalCost + cost);
    }

    return {
      totalCost,
      averageRate: params.quantity > 0 ? totalCost / params.quantity : 0,
      appliedWarehouseId: draws[0]?.layer.warehouse_id || warehouseId || undefined,
      lotExpiry,
    };
  }

  /**
   * What the ledger says the item is worth: Σ signed quantity and Σ signed amount of its stock movements
   * (receipts, issues, transfers, reversals). The moving-average cost is value / quantity.
   * excludeLedgerId leaves out the issue being priced, whose own row is already inserted.
   */
  private async bookBalance(
    executor: MySql2Database<typeof schema>,
    p: { tenantId: string; companyId: string; itemId: string; warehouseId?: string; excludeLedgerId?: string },
  ): Promise<{ quantity: number; value: number }> {
    const conditions = [
      eq(schema.inventoryLedger.tenant_id, p.tenantId),
      eq(schema.inventoryLedger.company_id, p.companyId),
      eq(schema.inventoryLedger.item_id, p.itemId),
      inArray(schema.inventoryLedger.entry_type, ['POSITIVE', 'NEGATIVE', 'TRANSFER']),
    ];
    if (p.warehouseId) conditions.push(eq(schema.inventoryLedger.warehouse_id, p.warehouseId));
    if (p.excludeLedgerId) conditions.push(ne(schema.inventoryLedger.ledger_id, p.excludeLedgerId));
    const [row] = await executor
      .select({
        quantity: sql<string>`COALESCE(SUM(${schema.inventoryLedger.quantity}), 0)`,
        value: sql<string>`COALESCE(SUM(${schema.inventoryLedger.amount}), 0)`,
      })
      .from(schema.inventoryLedger)
      .where(and(...conditions));
    return { quantity: Number(row?.quantity ?? 0), value: Number(row?.value ?? 0) };
  }

  /**
   * The location serial-tracked stock leaves from: the requested one if it holds every serial asked for,
   * otherwise the single location that does. A serial that is not in stock anywhere (never received, or
   * already issued) is refused, naming it.
   */
  private async locateSerials(
    params: { tenantId: string; companyId: string; itemId: string; warehouseId?: string; outboundLedgerId: string },
    serials: string[],
    executor: MySql2Database<typeof schema>,
  ): Promise<string | undefined> {
    const inStock = await serialsInStock(executor, { tenantId: params.tenantId, companyId: params.companyId, itemId: params.itemId, excludeLedgerId: params.outboundLedgerId });
    const where = new Map(inStock.map((x) => [x.serial_no, x.warehouse_id]));
    const missing = serials.filter((sn) => !where.has(sn));
    if (missing.length) {
      throw new BadRequestException(`Serial number(s) ${missing.join(', ')} cannot be issued: not in stock — never received, or already consumed.`);
    }
    const places = new Set(serials.map((sn) => where.get(sn) ?? null));
    if (params.warehouseId && places.size === 1 && places.has(params.warehouseId)) return params.warehouseId;
    if (places.size === 1) return [...places][0] ?? params.warehouseId;
    throw new BadRequestException(`The serial numbers picked are held at different locations — pick serials from one location.`);
  }

  /**
   * "Insufficient stock" that says what, where and how much — the item, the lot if one was named, the
   * location, what was there and what was needed. Looking those up is best effort: the refusal itself
   * must never fail because a name could not be read.
   */
  private async shortageMessage(
    params: { itemId: string; quantity: number; lotNo?: string; warehouseId?: string },
    available: number,
    short: number,
    executor: MySql2Database<typeof schema>,
  ): Promise<string> {
    let item = `item '${params.itemId}'`;
    let where = '';
    try {
      const [row] = await executor
        .select({ code: schema.itemMaster.item_code, name: schema.itemMaster.item_name })
        .from(schema.itemMaster)
        .where(eq(schema.itemMaster.item_id, params.itemId))
        .limit(1);
      if (row) item = `${row.code} — ${row.name}`;
      if (params.warehouseId) {
        const [wh] = await executor
          .select({ code: schema.locationMaster.location_code })
          .from(schema.locationMaster)
          .where(eq(schema.locationMaster.location_id, params.warehouseId))
          .limit(1);
        if (wh) where = ` at ${wh.code}`;
      }
    } catch {
      // keep the ids
    }
    const lot = params.lotNo ? ` (lot ${params.lotNo})` : '';
    return `Insufficient stock of ${item}${lot}${where}: ${roundMoney(available)} available, ${params.quantity} needed — short by ${roundMoney(short)}. Receive more stock or lower the quantity.`;
  }

  /**
   * What drawing `drawQty` from a layer costs. A draw that uses the layer up takes the value the layer
   * has left instead of qty x rate: rate is rounded to 6 places, and charging each draw separately
   * would leave a few paise stranded on the receipt (3 units for 10.00 consumed 1+1+1 = 9.9999).
   * Reversals post negative applications, so the sum below already nets them out.
   */
  private async layerDrawCost(
    layer: typeof schema.inventoryLedger.$inferSelect,
    drawQty: number,
    layerRemaining: number,
    executor: MySql2Database<typeof schema>,
  ): Promise<number> {
    const layerRate = Number(layer.rate || 0);
    let drawCost = roundMoney(drawQty * layerRate);
    if (drawQty >= layerRemaining) {
      const layerValue = layer.amount != null ? Number(layer.amount) : roundMoney(Number(layer.quantity) * layerRate);
      const [{ applied }] = await executor
        .select({ applied: sql<string>`COALESCE(SUM(${schema.inventoryApplication.applied_cost_amount}), 0)` })
        .from(schema.inventoryApplication)
        .where(eq(schema.inventoryApplication.inbound_ledger_id, layer.ledger_id));
      const remainingValue = roundMoney(layerValue - Number(applied));
      if (remainingValue >= 0) drawCost = remainingValue;
    }
    return drawCost;
  }

  /**
   * Writes a NEGATIVE (outbound) ledger entry — batch consumption lines, the
   * shipment leg of a Stock Transfer, and negative Stock Adjustment lines.
   * Cost is never user-supplied here; it's always derived from applyFifo
   * against existing inventory layers.
   *
   * The outbound row's insert, the FIFO layer consumption, and the final
   * rate/amount update all run inside one transaction — if applyFifo throws
   * (e.g. insufficient stock) partway through, everything it already wrote
   * rolls back instead of leaving an orphaned ledger row or a partially
   * consumed layer behind.
   */
  async writeNegativeEntry(params: WriteNegativeEntryParams) {
    if (params.quantity <= 0) {
      throw new BadRequestException(`Outbound quantity must be positive (got ${params.quantity}).`);
    }

    const [item] = await this.db
      .select()
      .from(schema.itemMaster)
      .where(eq(schema.itemMaster.item_id, params.itemId))
      .limit(1);

    if (!item) {
      throw new BadRequestException(`Item with ID '${params.itemId}' not found.`);
    }
    this.assertTracking(item, params.lotNo, params.serialNo, params.lots);
    if (params.lots && params.lotNo) {
      throw new BadRequestException('Name either one lot on the entry or several lots as lines, not both.');
    }

    const ledgerId = randomUUID();

    await this.db.transaction(async (tx) => {
      // Insert first so applyFifo has an outbound_ledger_id to attach applications to.
      await tx.insert(schema.inventoryLedger).values({
        ledger_id: ledgerId,
        tenant_id: params.tenantId,
        company_id: params.companyId,
        item_id: params.itemId,
        item_code: item.item_code,
        item_description: item.item_name,
        document_type: params.documentType,
        document_no: params.documentNo,
        document_line_id: params.documentLineId || null,
        posting_date: params.postingDate,
        external_reference_no: params.externalReferenceNo || null,
        entry_type: params.entryType || 'NEGATIVE',
        transaction_type: params.transactionType,
        quantity: (-Math.abs(params.quantity)).toString(),
        lot_no: params.lotNo || null,
        serial_no: params.serialNo || null,
        uom: params.uom,
        uom_conversion_factor: item.uom_conversion_factor,
        batch_no: params.batchNo || null,
        location_id: params.locationId || null,
        warehouse_id: params.warehouseId || null,
        nob_id: item.nob_id,
        lob_id: item.lob_id,
        category_id: item.category_id,
        created_by: params.userId || null,
      });

      const { totalCost, averageRate, appliedWarehouseId, lotExpiry } = await this.applyFifo(
        {
          tenantId: params.tenantId,
          companyId: params.companyId,
          itemId: params.itemId,
          outboundLedgerId: ledgerId,
          quantity: params.quantity,
          lotNo: params.lotNo,
          lots: params.lots,
          serialNo: params.serialNo,
          applicationDate: params.postingDate,
          userId: params.userId,
          warehouseId: params.warehouseId,
        },
        tx
      );

      const finalWarehouseId = appliedWarehouseId || params.warehouseId || null;
      // Several lots: one line per lot says where the stock physically came out; the cost lives on the
      // entry's applications. A single lot is named on the entry itself.
      if (params.lots?.length) {
        await tx.insert(schema.inventoryLedgerLine).values(
          params.lots.map((lot, i) => ({
            tenant_id: params.tenantId,
            company_id: params.companyId,
            ledger_id: ledgerId,
            line_no: i + 1,
            item_id: params.itemId,
            warehouse_id: finalWarehouseId,
            lot_no: lot.lotNo,
            quantity: (-Math.abs(lot.quantity)).toString(),
            expiry_date: lotExpiry?.get(lot.lotNo) ?? null,
          })),
        );
      }
      await tx
        .update(schema.inventoryLedger)
        .set({
          rate: averageRate.toString(),
          amount: (-totalCost).toString(),
          ...(finalWarehouseId ? { warehouse_id: finalWarehouseId } : {}),
        })
        .where(eq(schema.inventoryLedger.ledger_id, ledgerId));
    });

    return this.loadOne(ledgerId);
  }

  /**
   * Writes both legs of a Stock Transfer line: a NEGATIVE TRANSFER_SHIPMENT
   * at the source warehouse (cost via FIFO) and a POSITIVE TRANSFER_RECEIPT
   * at the destination warehouse, carrying forward the shipment's
   * weighted-average cost as the new layer's rate.
   */
  async writeTransferEntries(params: {
    tenantId: string;
    companyId: string;
    itemId: string;
    documentNo: string;
    documentLineId?: string;
    postingDate: string;
    quantity: number;
    uom: string;
    fromWarehouseId: string;
    toWarehouseId: string;
    lotNo?: string;
    serialNo?: string;
    userId?: string;
  }) {
    const shipment = await this.writeNegativeEntry({
      tenantId: params.tenantId,
      companyId: params.companyId,
      itemId: params.itemId,
      documentType: 'STOCK_TRANSFER',
      documentNo: params.documentNo,
      documentLineId: params.documentLineId,
      postingDate: params.postingDate,
      transactionType: 'TRANSFER_SHIPMENT',
      entryType: 'TRANSFER',
      quantity: params.quantity,
      uom: params.uom,
      lotNo: params.lotNo,
      serialNo: params.serialNo,
      warehouseId: params.fromWarehouseId,
      userId: params.userId,
    });

    // Carries the shipment's own lot/serial forward rather than params.lotNo/
    // serialNo directly — same value today, but shipment.lot_no is what FIFO
    // actually drew (relevant once a caller ever transfers without pinning a
    // lot), so the receipt layer's identity is always true to what left the
    // source warehouse.
    const receipt = await this.writePositiveEntry({
      tenantId: params.tenantId,
      companyId: params.companyId,
      itemId: params.itemId,
      documentType: 'STOCK_TRANSFER',
      documentNo: params.documentNo,
      documentLineId: params.documentLineId,
      postingDate: params.postingDate,
      transactionType: 'TRANSFER_RECEIPT',
      entryType: 'TRANSFER',
      quantity: params.quantity,
      uom: params.uom,
      rate: Number(shipment.rate),
      lotNo: shipment.lot_no || undefined,
      serialNo: shipment.serial_no || undefined,
      warehouseId: params.toWarehouseId,
      userId: params.userId,
    });

    return { shipment, receipt };
  }

  /** Ledger rows on the active farm. Batch issues carry no warehouse, so they reach their farm through the batch. */
  private farmConditions(): SQL[] {
    const scope = farmScope(this.cls);
    const conditions: SQL[] = [];
    if (scope.farmId) {
      conditions.push(or(
        locationOnFarm(schema.inventoryLedger.warehouse_id, scope.farmId),
        and(
          isNull(schema.inventoryLedger.warehouse_id),
          sql`EXISTS (SELECT 1 FROM batch_header b WHERE b.batch_no = ${schema.inventoryLedger.batch_no} AND b.company_id = ${schema.inventoryLedger.company_id} AND b.farm_id = ${scope.farmId})`,
        ),
      )!);
    }
    conditions.push(...restrictedScopeConditions(scope, {
      companyId: schema.inventoryLedger.company_id,
      lobId: schema.inventoryLedger.lob_id,
    }));
    return conditions;
  }

  /** Internal post-write read-back. The writer already authorized its source document; HTTP farm scope belongs only on public reads. */
  private async loadOne(ledgerId: string) {
    const [entry] = await this.db
      .select()
      .from(schema.inventoryLedger)
      .where(eq(schema.inventoryLedger.ledger_id, ledgerId))
      .limit(1);
    return entry;
  }

  async findOne(ledgerId: string) {
    const [entry] = await this.db
      .select()
      .from(schema.inventoryLedger)
      .where(and(eq(schema.inventoryLedger.ledger_id, ledgerId), ...this.farmConditions()))
      .limit(1);
    return entry;
  }

  async findOneWithDetails(ledgerId: string, tenantId?: string) {
    const conditions: any[] = [eq(schema.inventoryLedger.ledger_id, ledgerId), ...this.farmConditions()];
    if (tenantId) conditions.push(eq(schema.inventoryLedger.tenant_id, tenantId));

    const [entry] = await this.db
      .select()
      .from(schema.inventoryLedger)
      .where(and(...conditions))
      .limit(1);

    if (!entry) return null;

    let warehouse: any = null;
    if (entry.warehouse_id) {
      const [wh] = await this.db
        .select()
        .from(schema.locationMaster)
        .where(eq(schema.locationMaster.location_id, entry.warehouse_id))
        .limit(1);
      warehouse = wh || null;
    }

    let applications: any[] = [];
    const isInbound =
      entry.entry_type === 'POSITIVE' ||
      (entry.entry_type === 'TRANSFER' && Number(entry.quantity) > 0);

    if (isInbound) {
      applications = await this.db
        .select({
          application_id: schema.inventoryApplication.application_id,
          applied_qty: schema.inventoryApplication.applied_qty,
          applied_cost_amount: schema.inventoryApplication.applied_cost_amount,
          application_date: schema.inventoryApplication.application_date,
          created_at: schema.inventoryApplication.created_at,
          inbound_ledger_id: schema.inventoryApplication.inbound_ledger_id,
          outbound_ledger_id: schema.inventoryApplication.outbound_ledger_id,
          inbound_entry_no: schema.inventoryApplication.inbound_entry_no,
          outbound_entry_no: schema.inventoryApplication.outbound_entry_no,
          document_no: schema.inventoryLedger.document_no,
          document_type: schema.inventoryLedger.document_type,
          transaction_type: schema.inventoryLedger.transaction_type,
          lot_no: schema.inventoryLedger.lot_no,
          serial_no: schema.inventoryLedger.serial_no,
          rate: schema.inventoryLedger.rate,
          unit_cost: sql<string>`ROUND(CAST(${schema.inventoryApplication.applied_cost_amount} AS DECIMAL(18,4)) / NULLIF(CAST(${schema.inventoryApplication.applied_qty} AS DECIMAL(18,4)), 0), 4)`,
        })
        .from(schema.inventoryApplication)
        .leftJoin(
          schema.inventoryLedger,
          eq(schema.inventoryApplication.outbound_ledger_id, schema.inventoryLedger.ledger_id),
        )
        .where(eq(schema.inventoryApplication.inbound_ledger_id, ledgerId))
        .orderBy(asc(schema.inventoryApplication.application_date), asc(schema.inventoryApplication.created_at));
    } else {
      applications = await this.db
        .select({
          application_id: schema.inventoryApplication.application_id,
          applied_qty: schema.inventoryApplication.applied_qty,
          applied_cost_amount: schema.inventoryApplication.applied_cost_amount,
          application_date: schema.inventoryApplication.application_date,
          created_at: schema.inventoryApplication.created_at,
          inbound_ledger_id: schema.inventoryApplication.inbound_ledger_id,
          outbound_ledger_id: schema.inventoryApplication.outbound_ledger_id,
          inbound_entry_no: schema.inventoryApplication.inbound_entry_no,
          outbound_entry_no: schema.inventoryApplication.outbound_entry_no,
          document_no: schema.inventoryLedger.document_no,
          document_type: schema.inventoryLedger.document_type,
          transaction_type: schema.inventoryLedger.transaction_type,
          lot_no: schema.inventoryLedger.lot_no,
          serial_no: schema.inventoryLedger.serial_no,
          rate: schema.inventoryLedger.rate,
          inbound_posting_date: schema.inventoryLedger.posting_date,
          unit_cost: sql<string>`ROUND(CAST(${schema.inventoryApplication.applied_cost_amount} AS DECIMAL(18,4)) / NULLIF(CAST(${schema.inventoryApplication.applied_qty} AS DECIMAL(18,4)), 0), 4)`,
        })
        .from(schema.inventoryApplication)
        .leftJoin(
          schema.inventoryLedger,
          eq(schema.inventoryApplication.inbound_ledger_id, schema.inventoryLedger.ledger_id),
        )
        .where(eq(schema.inventoryApplication.outbound_ledger_id, ledgerId))
        .orderBy(asc(schema.inventoryApplication.application_date), asc(schema.inventoryApplication.created_at));
    }

    // Which lots the stock physically left (or came into): the entry's own lines when it issued from several
    // lots, otherwise the one lot named on the entry.
    const lineRows = await this.db
      .select()
      .from(schema.inventoryLedgerLine)
      .where(eq(schema.inventoryLedgerLine.ledger_id, ledgerId))
      .orderBy(asc(schema.inventoryLedgerLine.line_no));
    const lots = lineRows.length
      ? lineRows.map((l) => ({ line_no: l.line_no, lot_no: l.lot_no, serial_no: l.serial_no, quantity: Math.abs(Number(l.quantity)), expiry_date: l.expiry_date }))
      : entry.lot_no || entry.serial_no
      ? [{ line_no: 1, lot_no: entry.lot_no, serial_no: entry.serial_no, quantity: Math.abs(Number(entry.quantity)), expiry_date: entry.expiry_date }]
      : [];

    // Which animals took the stock, and each one's share of the quantity and the cost.
    const animals = await this.db
      .select({
        animal_id: schema.batchTransaction.animal_id,
        animal_code: schema.animalRegister.animal_code,
        quantity: schema.batchTransaction.quantity,
        amount: schema.batchTransaction.amount,
      })
      .from(schema.batchTransaction)
      .leftJoin(schema.animalRegister, eq(schema.animalRegister.animal_id, schema.batchTransaction.animal_id))
      .where(eq(schema.batchTransaction.ledger_id, ledgerId));

    return {
      ...entry,
      warehouse,
      lots,
      costing: !isInbound && applications.length > 0 ? await this.costingExplanation(entry, applications) : null,
      lot_issues: isInbound ? await this.lotIssues(entry) : [],
      animals: animals.filter((a) => a.animal_id),
      applications,
    };
  }

  /**
   * The working behind an issue's cost, for the "Show calculation" panel: FIFO lists each receipt drawn at
   * its own rate; Average adds the stock book as it stood before the entry (every earlier movement of the
   * item at the location, by Entry No.) and the average taken from it; Standard names the standard cost.
   */
  private async costingExplanation(entry: typeof schema.inventoryLedger.$inferSelect, applications: any[]) {
    const [item] = await this.db
      .select({ valuation_method: schema.itemMaster.valuation_method, standard_cost: schema.itemMaster.standard_cost })
      .from(schema.itemMaster)
      .where(eq(schema.itemMaster.item_id, entry.item_id!))
      .limit(1);
    const method = costingMethodOf(item?.valuation_method);

    let book: Parameters<typeof explainCosting>[0]['book'];
    if (method === 'AVG') {
      const before = [
        eq(schema.inventoryLedger.tenant_id, entry.tenant_id),
        eq(schema.inventoryLedger.company_id, entry.company_id),
        eq(schema.inventoryLedger.item_id, entry.item_id!),
        inArray(schema.inventoryLedger.entry_type, ['POSITIVE', 'NEGATIVE', 'TRANSFER']),
        lt(schema.inventoryLedger.entry_no, entry.entry_no!),
      ];
      if (entry.warehouse_id) before.push(eq(schema.inventoryLedger.warehouse_id, entry.warehouse_id));
      const q = schema.inventoryLedger.quantity;
      const a = schema.inventoryLedger.amount;
      const [sums] = await this.db
        .select({
          receiptsQuantity: sql<string>`COALESCE(SUM(CASE WHEN ${q} > 0 THEN ${q} ELSE 0 END), 0)`,
          receiptsValue: sql<string>`COALESCE(SUM(CASE WHEN ${q} > 0 THEN ${a} ELSE 0 END), 0)`,
          issuedQuantity: sql<string>`COALESCE(SUM(CASE WHEN ${q} < 0 THEN -${q} ELSE 0 END), 0)`,
          issuedValue: sql<string>`COALESCE(SUM(CASE WHEN ${q} < 0 THEN -${a} ELSE 0 END), 0)`,
        })
        .from(schema.inventoryLedger)
        .where(and(...before));
      const receiptRows = await this.db
        .select({
          entry_no: schema.inventoryLedger.entry_no,
          document_no: schema.inventoryLedger.document_no,
          posting_date: schema.inventoryLedger.posting_date,
          transaction_type: schema.inventoryLedger.transaction_type,
          quantity: schema.inventoryLedger.quantity,
          rate: schema.inventoryLedger.rate,
          amount: schema.inventoryLedger.amount,
        })
        .from(schema.inventoryLedger)
        .where(and(...before, sql`${q} > 0`))
        .orderBy(asc(schema.inventoryLedger.entry_no))
        .limit(50);
      const receipts: ExplainBookReceipt[] = receiptRows.map((r) => ({
        entry_no: r.entry_no,
        document_no: r.document_no,
        posting_date: r.posting_date ? String(r.posting_date).slice(0, 10) : null,
        transaction_type: r.transaction_type,
        quantity: Number(r.quantity),
        rate: Number(r.rate ?? 0),
        amount: Number(r.amount ?? 0),
      }));
      book = {
        receipts,
        receiptsQuantity: Number(sums?.receiptsQuantity ?? 0),
        receiptsValue: Number(sums?.receiptsValue ?? 0),
        issuedQuantity: Number(sums?.issuedQuantity ?? 0),
        issuedValue: Number(sums?.issuedValue ?? 0),
      };
    }

    return explainCosting({
      method,
      quantity: Math.abs(Number(entry.quantity)),
      totalCost: applications.reduce((n, x) => n + Number(x.applied_cost_amount || 0), 0),
      standardCost: item?.standard_cost != null ? Number(item.standard_cost) : null,
      draws: applications.map((x) => ({
        inbound_entry_no: x.inbound_entry_no,
        document_no: x.document_no,
        posting_date: x.inbound_posting_date ? String(x.inbound_posting_date).slice(0, 10) : null,
        lot_no: x.lot_no,
        receipt_rate: Number(x.rate ?? 0),
        quantity: Number(x.applied_qty),
        amount: Number(x.applied_cost_amount),
      })),
      book,
    });
  }

  /**
   * For a receipt of a lot or of serials: every entry that physically took stock out of (or, on a reversal,
   * put it back into) that lot or those serials. This is the physical trail; `applications` is the cost trail
   * (which receipt layer each issue was priced from) and the two need not agree.
   */
  private async lotIssues(entry: typeof schema.inventoryLedger.$inferSelect) {
    if (!entry.lot_no && !entry.serial_no) return [];
    const mine = new Set(parseSerials(entry.serial_no));
    const scope = [
      eq(schema.inventoryLedger.tenant_id, entry.tenant_id),
      eq(schema.inventoryLedger.company_id, entry.company_id),
      eq(schema.inventoryLedger.item_id, entry.item_id!),
      ne(schema.inventoryLedger.ledger_id, entry.ledger_id),
    ];
    const columns = {
      ledger_id: schema.inventoryLedger.ledger_id,
      entry_no: schema.inventoryLedger.entry_no,
      document_type: schema.inventoryLedger.document_type,
      document_no: schema.inventoryLedger.document_no,
      transaction_type: schema.inventoryLedger.transaction_type,
      posting_date: schema.inventoryLedger.posting_date,
      amount: schema.inventoryLedger.amount,
      warehouse_code: schema.locationMaster.location_code,
    };
    const onEntry = await this.db
      .select({ ...columns, quantity: schema.inventoryLedger.quantity, lot_no: schema.inventoryLedger.lot_no, serial_no: schema.inventoryLedger.serial_no })
      .from(schema.inventoryLedger)
      .leftJoin(schema.locationMaster, eq(schema.inventoryLedger.warehouse_id, schema.locationMaster.location_id))
      .where(and(...scope, or(lt(schema.inventoryLedger.quantity, '0'), eq(schema.inventoryLedger.transaction_type, 'REVERSAL'))!, entry.lot_no ? eq(schema.inventoryLedger.lot_no, entry.lot_no) : isNotNull(schema.inventoryLedger.serial_no)));
    const onLines = await this.db
      .select({ ...columns, quantity: schema.inventoryLedgerLine.quantity, lot_no: schema.inventoryLedgerLine.lot_no, serial_no: schema.inventoryLedgerLine.serial_no })
      .from(schema.inventoryLedgerLine)
      .innerJoin(schema.inventoryLedger, eq(schema.inventoryLedgerLine.ledger_id, schema.inventoryLedger.ledger_id))
      .leftJoin(schema.locationMaster, eq(schema.inventoryLedger.warehouse_id, schema.locationMaster.location_id))
      .where(and(...scope, entry.lot_no ? eq(schema.inventoryLedgerLine.lot_no, entry.lot_no) : isNotNull(schema.inventoryLedgerLine.serial_no)));
    return [...onEntry, ...onLines]
      .map((r) => {
        if (entry.lot_no) return { ...r, quantity: Number(r.quantity) };
        // Serials: only the ones this receipt brought in, signed like the entry that moved them.
        const matched = parseSerials(r.serial_no).filter((x) => mine.has(x));
        return { ...r, serial_no: matched.join(', '), quantity: (Number(r.quantity) < 0 ? -1 : 1) * matched.length };
      })
      .filter((r) => entry.lot_no || r.quantity !== 0)
      .sort((a, b) => Number(a.entry_no) - Number(b.entry_no));
  }

  /**
   * Complete purchase & consumption ledger history for an item.
   * Feeds the Stock Balance drill-down card with all inbound receipts (and remaining FIFO layers)
   * alongside all outbound consumptions and their exact linked application entries.
   */
  async getItemLedgerHistory(itemId: string, companyId: string, tenantId: string) {
    const [item] = await this.db
      .select()
      .from(schema.itemMaster)
      .where(and(eq(schema.itemMaster.item_id, itemId), eq(schema.itemMaster.tenant_id, tenantId)))
      .limit(1);

    if (!item) {
      throw new NotFoundException(`Item '${itemId}' not found.`);
    }

    const ledgerConditions: any[] = [
      eq(schema.inventoryLedger.tenant_id, tenantId),
      eq(schema.inventoryLedger.company_id, companyId),
      eq(schema.inventoryLedger.item_id, itemId),
      ...this.farmConditions(),
    ];

    const entries = await this.db
      .select({
        ledger_id: schema.inventoryLedger.ledger_id,
        entry_no: schema.inventoryLedger.entry_no,
        document_no: schema.inventoryLedger.document_no,
        document_type: schema.inventoryLedger.document_type,
        transaction_type: schema.inventoryLedger.transaction_type,
        entry_type: schema.inventoryLedger.entry_type,
        posting_date: schema.inventoryLedger.posting_date,
        quantity: schema.inventoryLedger.quantity,
        remaining_quantity: schema.inventoryLedger.remaining_quantity,
        uom: schema.inventoryLedger.uom,
        rate: schema.inventoryLedger.rate,
        amount: schema.inventoryLedger.amount,
        lot_no: schema.inventoryLedger.lot_no,
        serial_no: schema.inventoryLedger.serial_no,
        batch_no: schema.inventoryLedger.batch_no,
        warehouse_id: schema.inventoryLedger.warehouse_id,
        warehouse_code: schema.locationMaster.location_code,
        warehouse_name: schema.locationMaster.location_name,
        external_reference_no: schema.inventoryLedger.external_reference_no,
        created_at: schema.inventoryLedger.created_at,
      })
      .from(schema.inventoryLedger)
      .leftJoin(schema.locationMaster, eq(schema.inventoryLedger.warehouse_id, schema.locationMaster.location_id))
      .where(and(...ledgerConditions))
      .orderBy(desc(schema.inventoryLedger.posting_date), desc(schema.inventoryLedger.created_at));

    const applications = await this.db
      .select({
        application_id: schema.inventoryApplication.application_id,
        inbound_ledger_id: schema.inventoryApplication.inbound_ledger_id,
        outbound_ledger_id: schema.inventoryApplication.outbound_ledger_id,
        inbound_entry_no: schema.inventoryApplication.inbound_entry_no,
        outbound_entry_no: schema.inventoryApplication.outbound_entry_no,
        applied_qty: schema.inventoryApplication.applied_qty,
        applied_cost_amount: schema.inventoryApplication.applied_cost_amount,
        application_date: schema.inventoryApplication.application_date,
        inbound_document_no: schema.inventoryLedger.document_no,
        inbound_document_type: schema.inventoryLedger.document_type,
        inbound_rate: schema.inventoryLedger.rate,
        inbound_lot_no: schema.inventoryLedger.lot_no,
        inbound_serial_no: schema.inventoryLedger.serial_no,
        unit_cost: sql<string>`ROUND(CAST(${schema.inventoryApplication.applied_cost_amount} AS DECIMAL(18,4)) / NULLIF(CAST(${schema.inventoryApplication.applied_qty} AS DECIMAL(18,4)), 0), 4)`,
      })
      .from(schema.inventoryApplication)
      .leftJoin(
        schema.inventoryLedger,
        eq(schema.inventoryApplication.inbound_ledger_id, schema.inventoryLedger.ledger_id),
      )
      .where(and(
        eq(schema.inventoryApplication.tenant_id, tenantId),
        eq(schema.inventoryApplication.company_id, companyId),
        eq(schema.inventoryApplication.item_id, itemId),
      ))
      .orderBy(desc(schema.inventoryApplication.application_date), desc(schema.inventoryApplication.created_at));

    const inboundEntries = entries
      .filter((e) => Number(e.quantity) > 0)
      .map((e) => {
        const apps = applications.filter((a) => a.inbound_ledger_id === e.ledger_id);
        const qtyNum = Number(e.quantity);
        const remNum = Number(e.remaining_quantity ?? qtyNum);
        const consumedQty = Math.max(0, qtyNum - remNum);
        return {
          ...e,
          consumed_qty: consumedQty,
          applications: apps,
        };
      });

    const outboundEntries = entries
      .filter((e) => Number(e.quantity) < 0)
      .map((e) => {
        const apps = applications.filter((a) => a.outbound_ledger_id === e.ledger_id);
        return {
          ...e,
          // What the entry cost in total: the sum of what it drew from each source entry.
          applied_cost_total: apps.reduce((sum, a) => sum + Number(a.applied_cost_amount || 0), 0),
          applications: apps,
        };
      });

    const totalOnHand = inboundEntries.reduce((sum, e) => sum + Number(e.remaining_quantity || 0), 0);
    // FIFO values what is left receipt by receipt; Average values the book (Σ signed amounts), since
    // its issues are priced at the running average rather than at the receipt they drew from.
    const averaged = ['AVG', 'AVERAGE'].includes(String(item.valuation_method || '').toUpperCase());
    const totalValuation = averaged
      ? entries.filter((e) => ['POSITIVE', 'NEGATIVE', 'TRANSFER'].includes(String(e.entry_type))).reduce((sum, e) => sum + Number(e.amount || 0), 0)
      : inboundEntries.reduce((sum, e) => sum + Number(e.remaining_quantity || 0) * Number(e.rate || 0), 0);

    return {
      item: {
        item_id: item.item_id,
        item_code: item.item_code,
        item_name: item.item_name,
        uom_primary: item.uom_primary,
        valuation_method: item.valuation_method || 'FIFO',
        reorder_level: item.reorder_level != null ? Number(item.reorder_level) : null,
        min_stock_level: item.min_stock_level != null ? Number(item.min_stock_level) : null,
        max_stock_level: item.max_stock_level != null ? Number(item.max_stock_level) : null,
      },
      summary: {
        total_on_hand: totalOnHand,
        total_valuation: totalValuation,
        inbound_count: inboundEntries.length,
        outbound_count: outboundEntries.length,
      },
      inbound_entries: inboundEntries,
      outbound_entries: outboundEntries,
    };
  }

  async findAll(query: QueryInventoryLedgerDto, tenantId: string) {
    const conditions = this.listConditions(query, tenantId);
    const limit = query.limit || 50;
    const offset = query.offset || 0;

    return this.db
      .select({
        ...getTableColumns(schema.inventoryLedger),
        // How many lots the entry issued from, when it names them as lines rather than on the entry itself.
        lot_lines: sql<number>`(select count(*) from ${schema.inventoryLedgerLine} where ${schema.inventoryLedgerLine.ledger_id} = ${schema.inventoryLedger.ledger_id})`.mapWith(Number),
      })
      .from(schema.inventoryLedger)
      .where(and(...conditions))
      .orderBy(...this.listOrder(query))
      .limit(limit)
      .offset(offset);
  }

  /**
   * Every ledger row matching the list filters (not one page), with the item
   * category and the location codes and names the screen shows, for the Excel
   * and CSV export. Capped so a runaway filter cannot exhaust the server; the
   * caller is told when the cap cut the result short.
   */
  async findAllForExport(query: QueryInventoryLedgerDto, tenantId: string): Promise<{ rows: LedgerExportRow[]; truncated: boolean }> {
    const conditions = this.listConditions(query, tenantId);
    // locationMaster refers to itself (parent_location_id), which defeats alias()'s own typing.
    const warehouse = alias(schema.locationMaster as any, 'wh') as unknown as typeof schema.locationMaster;
    const batchLocation = alias(schema.locationMaster as any, 'bl') as unknown as typeof schema.locationMaster;

    const rows = await this.db
      .select({
        ledger_id: schema.inventoryLedger.ledger_id,
        entry_no: schema.inventoryLedger.entry_no,
        posting_date: schema.inventoryLedger.posting_date,
        document_type: schema.inventoryLedger.document_type,
        document_no: schema.inventoryLedger.document_no,
        external_reference_no: schema.inventoryLedger.external_reference_no,
        entry_type: schema.inventoryLedger.entry_type,
        transaction_type: schema.inventoryLedger.transaction_type,
        item_code: schema.inventoryLedger.item_code,
        item_description: schema.inventoryLedger.item_description,
        category_code: schema.itemCategoryMaster.category_code,
        category_name: schema.itemCategoryMaster.category_name,
        quantity: schema.inventoryLedger.quantity,
        remaining_quantity: schema.inventoryLedger.remaining_quantity,
        uom: schema.inventoryLedger.uom,
        uom_conversion_factor: schema.inventoryLedger.uom_conversion_factor,
        alternate_quantity: schema.inventoryLedger.alternate_quantity,
        rate: schema.inventoryLedger.rate,
        amount: schema.inventoryLedger.amount,
        lot_no: schema.inventoryLedger.lot_no,
        serial_no: schema.inventoryLedger.serial_no,
        expiry_date: schema.inventoryLedger.expiry_date,
        batch_no: schema.inventoryLedger.batch_no,
        warehouse_code: warehouse.location_code,
        warehouse_name: warehouse.location_name,
        location_code: batchLocation.location_code,
        location_name: batchLocation.location_name,
        created_by: schema.inventoryLedger.created_by,
        created_at: schema.inventoryLedger.created_at,
      })
      .from(schema.inventoryLedger)
      .leftJoin(schema.itemCategoryMaster, eq(schema.inventoryLedger.category_id, schema.itemCategoryMaster.category_id))
      .leftJoin(warehouse, eq(schema.inventoryLedger.warehouse_id, warehouse.location_id))
      .leftJoin(batchLocation, eq(schema.inventoryLedger.location_id, batchLocation.location_id))
      .where(and(...conditions))
      .orderBy(...this.listOrder(query))
      .limit(LEDGER_EXPORT_MAX_ROWS + 1);

    const truncated = rows.length > LEDGER_EXPORT_MAX_ROWS;
    return { rows: (truncated ? rows.slice(0, LEDGER_EXPORT_MAX_ROWS) : rows) as LedgerExportRow[], truncated };
  }

  private listOrder(query: QueryInventoryLedgerDto) {
    return query.sortBy === 'posting_date'
      ? [desc(schema.inventoryLedger.posting_date), desc(schema.inventoryLedger.entry_no)]
      : [desc(schema.inventoryLedger.entry_no)];
  }

  /** The list filters, shared by the paged list and the export so the file always matches the screen. */
  private listConditions(query: QueryInventoryLedgerDto, tenantId: string): any[] {
    const conditions: any[] = [eq(schema.inventoryLedger.tenant_id, tenantId), ...this.farmConditions()];

    if (query.companyId) conditions.push(eq(schema.inventoryLedger.company_id, query.companyId));
    if (query.itemId) conditions.push(eq(schema.inventoryLedger.item_id, query.itemId));
    if (query.entryNo) conditions.push(eq(schema.inventoryLedger.entry_no, query.entryNo));
    if (query.locationId) conditions.push(eq(schema.inventoryLedger.location_id, query.locationId));
    if (query.warehouseId) conditions.push(eq(schema.inventoryLedger.warehouse_id, query.warehouseId));
    if (query.entryType) conditions.push(eq(schema.inventoryLedger.entry_type, query.entryType));
    if (query.transactionType) {
      if (query.transactionType === 'CONSUMPTION') {
        conditions.push(
          or(
            eq(schema.inventoryLedger.transaction_type, 'CONSUMPTION'),
            like(schema.inventoryLedger.transaction_type, '%CONSUMPTION%'),
          ),
        );
      } else if (query.transactionType === 'OUTPUT') {
        conditions.push(
          or(
            eq(schema.inventoryLedger.transaction_type, 'OUTPUT'),
            like(schema.inventoryLedger.transaction_type, '%OUTPUT%'),
          ),
        );
      } else {
        conditions.push(eq(schema.inventoryLedger.transaction_type, query.transactionType));
      }
    }
    if (query.documentType) conditions.push(eq(schema.inventoryLedger.document_type, query.documentType));
    if (query.documentNo) {
      conditions.push(
        or(
          like(schema.inventoryLedger.document_no, `%${query.documentNo}%`),
          like(schema.inventoryLedger.batch_no, `%${query.documentNo}%`),
        )!,
      );
    }
    if (query.dateFrom) conditions.push(gte(schema.inventoryLedger.posting_date, query.dateFrom));
    if (query.dateTo) conditions.push(lte(schema.inventoryLedger.posting_date, query.dateTo));

    return conditions;
  }

  /**
   * Current on-hand quantity per item/warehouse — the FIFO-layer view: each
   * POSITIVE ledger entry (receipt/output/transfer-in) is a layer, and
   * remaining_quantity already tracks what hasn't been consumed off it yet
   * (see writeNegativeEntry's applyFifo). Summing remaining_quantity across
   * an item's layers is exactly its current stock; no separate running
   * balance is maintained anywhere else, so this is computed on read.
   */
  async getStockBalance(query: QueryStockBalanceDto, tenantId: string) {
    const conditions: any[] = [
      eq(schema.inventoryLedger.tenant_id, tenantId),
      eq(schema.inventoryLedger.company_id, query.companyId),
      inArray(schema.inventoryLedger.entry_type, ['POSITIVE', 'TRANSFER']),
      isNotNull(schema.inventoryLedger.remaining_quantity),
      ...this.farmConditions(),
    ];
    if (query.warehouseId) conditions.push(eq(schema.inventoryLedger.warehouse_id, query.warehouseId));
    if (query.itemId) conditions.push(eq(schema.inventoryLedger.item_id, query.itemId));
    if (query.nobId) conditions.push(eq(schema.itemMaster.nob_id, query.nobId));
    if (query.lobId) conditions.push(eq(schema.itemMaster.lob_id, query.lobId));

    const rows = await this.db
      .select({
        item_id: schema.inventoryLedger.item_id,
        item_code: schema.inventoryLedger.item_code,
        item_description: schema.inventoryLedger.item_description,
        uom: schema.inventoryLedger.uom,
        warehouse_id: schema.inventoryLedger.warehouse_id,
        warehouse_code: schema.locationMaster.location_code,
        warehouse_name: schema.locationMaster.location_name,
        reorder_level: schema.itemMaster.reorder_level,
        min_stock_level: schema.itemMaster.min_stock_level,
        max_stock_level: schema.itemMaster.max_stock_level,
        on_hand_qty: sql<string>`COALESCE(SUM(${schema.inventoryLedger.remaining_quantity}), 0)`,
        on_hand_value: sql<string>`COALESCE(SUM(${schema.inventoryLedger.remaining_quantity} * ${schema.inventoryLedger.rate}), 0)`,
      })
      .from(schema.inventoryLedger)
      .leftJoin(schema.locationMaster, eq(schema.inventoryLedger.warehouse_id, schema.locationMaster.location_id))
      .innerJoin(schema.itemMaster, eq(schema.inventoryLedger.item_id, schema.itemMaster.item_id))
      .where(and(...conditions))
      .groupBy(
        schema.inventoryLedger.item_id,
        schema.inventoryLedger.item_code,
        schema.inventoryLedger.item_description,
        schema.inventoryLedger.uom,
        schema.inventoryLedger.warehouse_id,
        schema.locationMaster.location_code,
        schema.locationMaster.location_name,
        schema.itemMaster.reorder_level,
        schema.itemMaster.min_stock_level,
        schema.itemMaster.max_stock_level,
      );

    // Average-costed items are worth their book value (Σ signed amounts), not their receipts' prices:
    // issues are priced at the running average, so what is left is no longer receipt-by-receipt.
    const bookConditions: any[] = conditions.filter((c) => c !== conditions[2] && c !== conditions[3]);
    bookConditions.push(inArray(schema.inventoryLedger.entry_type, ['POSITIVE', 'NEGATIVE', 'TRANSFER']));
    bookConditions.push(inArray(schema.itemMaster.valuation_method, ['AVG', 'AVERAGE']));
    const bookRows = await this.db
      .select({
        item_id: schema.inventoryLedger.item_id,
        warehouse_id: schema.inventoryLedger.warehouse_id,
        value: sql<string>`COALESCE(SUM(${schema.inventoryLedger.amount}), 0)`,
      })
      .from(schema.inventoryLedger)
      .innerJoin(schema.itemMaster, eq(schema.inventoryLedger.item_id, schema.itemMaster.item_id))
      .where(and(...bookConditions))
      .groupBy(schema.inventoryLedger.item_id, schema.inventoryLedger.warehouse_id);
    const bookValue = new Map(bookRows.map((b) => [`${b.item_id}|${b.warehouse_id}`, Number(b.value)]));

    const balances = rows
      .map((r) => ({
        ...r,
        item_id: r.item_id!,
        on_hand_qty: Number(r.on_hand_qty),
        on_hand_value: bookValue.get(`${r.item_id}|${r.warehouse_id}`) ?? Number(r.on_hand_value),
        reorder_level: r.reorder_level != null ? Number(r.reorder_level) : null,
        min_stock_level: r.min_stock_level != null ? Number(r.min_stock_level) : null,
        max_stock_level: r.max_stock_level != null ? Number(r.max_stock_level) : null,
      }))
      .filter((r) => r.on_hand_qty > 0.0001)
      .sort((a, b) => a.item_code.localeCompare(b.item_code));

    if (query.belowReorderOnly) {
      return balances.filter((r) => r.reorder_level != null && r.on_hand_qty <= r.reorder_level);
    }
    return balances;
  }

  /**
   * Feed Forecast (Plan R, spec D19, open question Q6): feed stock of the given
   * silos and stores *as of a date*. getStockBalance reads FIFO remaining
   * quantities, which have no date; the signed quantities do, and their sum is
   * the same number (checked on nf_devco, 26 Sep: every silo and store
   * agreed) — only POSITIVE and NEGATIVE entries move stock. `opening` is
   * everything posted before `stockDate`; `movements` is every posted
   * movement from `stockDate` to `horizonTo` that is not feeding — daily entry
   * posts its feed as document_type BATCH (and its reversal copies that type),
   * the only feeding there is: feeding from the stock date on is exactly what
   * the forecast projects, and counting both would take it twice. A Goods
   * Issue (transaction_type CONSUMPTION) is not feeding — feed issued out of a
   * silo or store by hand is an outflow the projection knows nothing of — so
   * it counts, signed, and its REVERSAL (same document_type, positive) nets it
   * back out on the same terms (fix round 1, Ruling M7). Farm-scoped like
   * every read here.
   */
  async getFeedStockAsOf(
    params: { companyId: string; warehouseIds: string[]; stockDate: string; horizonTo: string },
    tenantId: string,
  ): Promise<{ opening: FeedStockRow[]; movements: FeedStockMovement[] }> {
    if (!params.warehouseIds.length) return { opening: [], movements: [] };
    const L = schema.inventoryLedger;
    const base = [
      eq(L.tenant_id, tenantId),
      eq(L.company_id, params.companyId),
      isNotNull(L.item_id),
      inArray(L.warehouse_id, params.warehouseIds),
      inArray(L.entry_type, ['POSITIVE', 'NEGATIVE', 'TRANSFER']),
      ...this.farmConditions(),
    ];
    const qty = sql<string>`COALESCE(SUM(${L.quantity}), 0)`;
    const itemCode = sql<string>`MAX(${L.item_code})`;
    const opening = await this.db
      .select({ warehouse_id: L.warehouse_id, item_id: L.item_id, item_code: itemCode, uom: L.uom, qty })
      .from(L)
      .where(and(...base, lt(L.posting_date, params.stockDate)))
      .groupBy(L.warehouse_id, L.item_id, L.uom);
    const movements = await this.db
      .select({ warehouse_id: L.warehouse_id, item_id: L.item_id, item_code: itemCode, uom: L.uom, posting_date: L.posting_date, qty })
      .from(L)
      .where(and(
        ...base,
        gte(L.posting_date, params.stockDate),
        lte(L.posting_date, params.horizonTo),
        ne(L.document_type, 'BATCH'),
      ))
      .groupBy(L.warehouse_id, L.item_id, L.uom, L.posting_date);
    return {
      opening: opening
        .filter((r) => r.warehouse_id && r.item_id)
        .map((r) => ({ warehouse_id: r.warehouse_id!, item_id: r.item_id!, item_code: r.item_code, uom: r.uom, qty: Number(r.qty) })),
      movements: movements
        .filter((r) => r.warehouse_id && r.item_id)
        .map((r) => ({ warehouse_id: r.warehouse_id!, item_id: r.item_id!, item_code: r.item_code, uom: r.uom, posting_date: r.posting_date, qty: Number(r.qty) })),
    };
  }

  async getAvailableLots(query: QueryAvailableLotsDto, tenantId: string) {
    const itemId = query.itemId || query.item_id;
    if (!itemId) {
      throw new BadRequestException('itemId is required.');
    }
    const warehouseId = query.warehouseId || query.warehouse_id;
    const companyId = query.companyId || query.company_id;

    const scope = farmScope(this.cls);
    // What each lot holds — read off the lots themselves, not off any receipt's remaining quantity (that
    // belongs to costing). Farm scope applies to the entries and to the lines alike.
    const balances = await lotBalances(this.db, {
      tenantId,
      itemId,
      companyId,
      warehouseId,
      scopeConditions: (cols) => [
        ...locationReferenceScopeConditions(scope, cols.warehouse_id),
        ...restrictedScopeConditions(scope, { companyId: cols.company_id }),
      ],
    });

    const today = new Date().toISOString().slice(0, 10);
    const lots = balances
      .filter((r) => r.quantity > 0.0001)
      .map((r) => ({
        lot_no: r.lot_no,
        remaining_quantity: r.quantity,
        expiry_date: r.expiry_date,
        posting_date: r.receipt_date,
        expired: !!r.expiry_date && String(r.expiry_date).slice(0, 10) < today,
      }))
      // Usable lots first — earliest expiry, then oldest receipt — and expired lots last, so the
      // first row is the lot to suggest.
      .sort((a, b) => {
        if (a.expired !== b.expired) return a.expired ? 1 : -1;
        if (a.expiry_date && b.expiry_date) {
          const expDiff = new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime();
          if (expDiff !== 0) return expDiff;
        } else if (a.expiry_date && !b.expiry_date) {
          return -1;
        } else if (!a.expiry_date && b.expiry_date) {
          return 1;
        }
        return new Date(a.posting_date).getTime() - new Date(b.posting_date).getTime();
      });
    const suggestedIndex = lots.findIndex((l) => !l.expired);
    return lots.map((l, i) => ({ ...l, suggested: i === suggestedIndex }));
  }

  async getAvailableSerials(query: QueryAvailableSerialsDto, tenantId: string) {
    const itemId = query.itemId || query.item_id;
    if (!itemId) {
      throw new BadRequestException('itemId is required.');
    }
    const warehouseId = query.warehouseId || query.warehouse_id;
    const companyId = query.companyId || query.company_id;

    const scope = farmScope(this.cls);
    const [item] = await this.db
      .select({ shelf_life_days: schema.itemMaster.shelf_life_days })
      .from(schema.itemMaster)
      .where(eq(schema.itemMaster.item_id, itemId))
      .limit(1);
    // The serials in stock: counted in by the entries that carry them and out by the entries that issue
    // them — not read off any receipt's remaining quantity (that belongs to costing).
    const inStock = await serialsInStock(this.db, {
      tenantId,
      itemId,
      companyId,
      warehouseId,
      scopeConditions: (cols) => [
        ...locationReferenceScopeConditions(scope, cols.warehouse_id),
        ...restrictedScopeConditions(scope, { companyId: cols.company_id }),
      ],
    });
    return inStock
      .map((r) => {
        let effectiveExpiry = r.expiry_date;
        if (!effectiveExpiry && r.receipt_date && r.receipt_date !== '9999-12-31') {
          const days = item?.shelf_life_days ? Number(item.shelf_life_days) : 365;
          const d = new Date(r.receipt_date);
          d.setDate(d.getDate() + days);
          effectiveExpiry = d.toISOString().slice(0, 10);
        }
        return {
          serial_no: r.serial_no,
          remaining_quantity: 1,
          expiry_date: effectiveExpiry,
          posting_date: r.receipt_date,
          warehouse_id: r.warehouse_id,
        };
      })
      .sort((a, b) => (a.posting_date < b.posting_date ? -1 : a.posting_date > b.posting_date ? 1 : 0));
  }
}
