import { Injectable, BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { eq, and, ne, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';
import * as schema from '../../../core/database/schema';
import { InventoryLedgerService } from '../inventory-ledger/inventory-ledger.service';

export type SiloDocumentLabel = 'Stock Transfer' | 'Goods Receipt';

/**
 * One home for the rules that decide what a silo may hold (spec D9):
 * - a silo holds exactly one feed item at a time;
 * - a different feed only enters an empty silo;
 * - two silos feeding the same shed may not hold the same item, because a
 *   daily feed entry against that shed would then have no single source to
 *   draw from.
 *
 * Both writers that can change what is physically in a silo — a posted
 * Stock Transfer (feed IN) and a posted Goods Receipt landed straight on a
 * silo — call `assertCanReceive` before they move anything. Attaching a
 * silo to a shed (location-master maintenance, not a stock movement) calls
 * `assertAttachable` instead, since D9 applies there too: linking a second
 * silo already holding a shed's item would create the same ambiguity
 * without a single unit of stock moving.
 */
@Injectable()
export class SiloFeedService {
  constructor(
    private readonly cls: ClsService,
    private readonly ledgerService: InventoryLedgerService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  /**
   * The item currently resident in each silo, keyed by silo_id; `null` means
   * empty. getStockBalance() only ever returns positive balances and a silo
   * holds at most one item, so its first row (if any) is the whole answer —
   * one call per silo, since getStockBalance is scoped to a single warehouse.
   * `uom` rides along so the feed forecast can refuse a silo whose balance is
   * not in KG rather than add bags to kilograms.
   */
  async currentItems(
    siloIds: string[],
    companyId: string,
    tenantId: string,
  ): Promise<Map<string, { item_id: string; item_code: string; item_description: string | null; on_hand_qty: number; uom: string } | null>> {
    const result = new Map<
      string,
      { item_id: string; item_code: string; item_description: string | null; on_hand_qty: number; uom: string } | null
    >();
    for (const siloId of siloIds) {
      const balances = await this.ledgerService.getStockBalance(
        { companyId, warehouseId: siloId } as any,
        tenantId,
      );
      const resident = balances[0];
      result.set(
        siloId,
        resident
          ? {
              item_id: resident.item_id,
              item_code: resident.item_code,
              item_description: resident.item_description ?? null,
              on_hand_qty: resident.on_hand_qty,
              uom: resident.uom,
            }
          : null,
      );
    }
    return result;
  }

  /**
   * Refuses a posting into `siloId` that would violate D9. Both callers post
   * item movement in KG-agnostic quantities they already validated
   * elsewhere (stock transfer keeps its own capacity/KG check after this
   * call returns) — this only ever looks at *which* items, never how much.
   *
   * `documentLabel` picks the noun in the refusal message so it reads
   * naturally for whichever document is posting ('Stock Transfer' carries a
   * "transfer", 'Goods Receipt' a "receipt"); it defaults to 'Stock
   * Transfer' so existing callers/messages are unaffected.
   */
  async assertCanReceive(params: {
    siloId: string;
    siloName: string;
    companyId: string;
    tenantId: string;
    itemIds: string[];
    documentLabel?: SiloDocumentLabel;
  }): Promise<void> {
    const { siloId, siloName, companyId, tenantId, itemIds } = params;
    const documentLabel = params.documentLabel ?? 'Stock Transfer';
    const documentNoun = documentLabel === 'Goods Receipt' ? 'receipt' : 'transfer';

    // A silo holds ONE feed item at a time, so a document that carries two of
    // them into the same silo is refused on the document alone, before any
    // stock is read.
    const incoming = new Set(itemIds);
    if (incoming.size > 1) {
      throw new BadRequestException(
        `Cannot post this ${documentLabel} — silo '${siloName}' holds one feed item at a time and this ${documentNoun} carries ${incoming.size} different items.`,
      );
    }
    const [incomingItemId] = incoming;

    const own = (await this.currentItems([siloId], companyId, tenantId)).get(siloId) ?? null;
    if (own && incomingItemId && own.item_id !== incomingItemId) {
      throw new BadRequestException(
        `Cannot post this ${documentLabel} — silo '${siloName}' already holds '${own.item_code}'. A silo holds one feed item at a time; empty it before moving a different item in.`,
      );
    }

    if (!incomingItemId) return;

    await this.assertNoSiblingHoldsItem(siloId, incomingItemId, companyId, tenantId, documentLabel);
  }

  /**
   * D9's third rule, checked at post() rather than at the link table: every
   * other silo linked to any shed this silo also feeds is the only set of
   * silos whose current item could make a shed's daily draw ambiguous.
   */
  private async assertNoSiblingHoldsItem(
    siloId: string,
    itemId: string,
    companyId: string,
    tenantId: string,
    documentLabel: string,
  ): Promise<void> {
    const mine = alias(schema.siloShedLink, 'mine');
    const other = alias(schema.siloShedLink, 'other');

    // Every other silo that shares a shed with this one — the only silos whose
    // item could make a posting ambiguous (D9).
    const siblings = await this.db
      .selectDistinct({
        silo_id: other.silo_id,
        shed_id: mine.shed_id,
        shed_code: schema.locationMaster.location_code,
      })
      .from(mine)
      .innerJoin(other, and(eq(other.shed_id, mine.shed_id), ne(other.silo_id, mine.silo_id)))
      .innerJoin(schema.locationMaster, eq(schema.locationMaster.location_id, mine.shed_id))
      .where(and(eq(mine.silo_id, siloId), eq(mine.tenant_id, tenantId)));

    if (siblings.length === 0) return;

    const siblingSiloIds = [...new Set(siblings.map((s) => s.silo_id))];
    const items = await this.currentItems(siblingSiloIds, companyId, tenantId);
    const siloCodeById = await this.locationCodesById(siblingSiloIds);

    for (const sibling of siblings) {
      const resident = items.get(sibling.silo_id);
      if (resident && resident.item_id === itemId) {
        throw new BadRequestException(
          `Cannot post this ${documentLabel} — Shed '${sibling.shed_code}' already draws '${resident.item_code}' from silo '${siloCodeById.get(sibling.silo_id) ?? sibling.silo_id}'.`,
        );
      }
    }
  }

  /**
   * D9 at attach time (silo <-> shed maintenance, not a stock movement): a
   * silo carrying an item may not be linked to a shed another silo already
   * feeds the same item, for the same ambiguity reason `assertCanReceive`
   * refuses it on posting. No-op when this silo is empty — an empty silo
   * cannot conflict with anything yet.
   */
  async assertAttachable(params: {
    siloId: string;
    shedIds: string[];
    companyId: string;
    tenantId: string;
  }): Promise<void> {
    const { siloId, shedIds, companyId, tenantId } = params;
    if (shedIds.length === 0) return;

    const own = (await this.currentItems([siloId], companyId, tenantId)).get(siloId) ?? null;
    if (!own) return;

    const others = await this.db
      .select({ silo_id: schema.siloShedLink.silo_id, shed_id: schema.siloShedLink.shed_id })
      .from(schema.siloShedLink)
      .where(
        and(
          inArray(schema.siloShedLink.shed_id, shedIds),
          ne(schema.siloShedLink.silo_id, siloId),
          eq(schema.siloShedLink.tenant_id, tenantId),
        ),
      );
    if (others.length === 0) return;

    const otherSiloIds = [...new Set(others.map((o) => o.silo_id))];
    const items = await this.currentItems(otherSiloIds, companyId, tenantId);
    const shedCodeById = await this.locationCodesById(shedIds);
    const siloCodeById = await this.locationCodesById([siloId, ...otherSiloIds]);

    for (const other of others) {
      const resident = items.get(other.silo_id);
      if (resident && resident.item_id === own.item_id) {
        throw new BadRequestException(
          `Cannot attach silo '${siloCodeById.get(siloId) ?? siloId}' to shed '${shedCodeById.get(other.shed_id) ?? other.shed_id}' — silo '${siloCodeById.get(other.silo_id) ?? other.silo_id}' already draws '${resident.item_code}' from there. A shed may draw one feed item at a time.`,
        );
      }
    }
  }

  private async locationCodesById(locationIds: string[]): Promise<Map<string, string>> {
    if (locationIds.length === 0) return new Map();
    const rows = await this.db
      .select({ location_id: schema.locationMaster.location_id, location_code: schema.locationMaster.location_code })
      .from(schema.locationMaster)
      .where(inArray(schema.locationMaster.location_id, locationIds));
    return new Map(rows.map((r) => [r.location_id, r.location_code]));
  }
}
