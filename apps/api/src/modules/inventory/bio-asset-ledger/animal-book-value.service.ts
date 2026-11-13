import { Injectable } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { bioEventOf, bioEventsCondition, type BioEvent } from './bio-asset-ledger.types';

/**
 * An animal's cost and book value, read from her own rows in the bio-asset ledger (animal_id on the row), not
 * from the plain columns on animal_register. Those columns are set once at registration and went stale from the
 * first feed that was capitalised; they are now only a cache, refreshed from here (refreshCache).
 *
 *   book value = acquisition + capitalised cost - accumulated amortisation +/- fair value - what has left
 *
 * A batch transfer row moves an animal between batches without changing what she is worth, and a PURCHASE row is
 * the GRN's receipt of animals (no animal yet), so neither counts. Everything else the ledger holds for an animal does.
 * Rows are told apart by the event they record (bioEventOf), not by their entry type, which several events share.
 */
export const BOOK_VALUE_EVENTS: readonly BioEvent[] = [
  'ACQUISITION', 'CONSUMPTION', 'OVERHEAD_COST', 'AMORTIZATION', 'FAIR_VALUE_ADJMT', 'MORTALITY', 'TRANSFORMATION', 'COST_ALLOCATION',
];

const CAPITALISED = new Set<BioEvent>(['CONSUMPTION', 'OVERHEAD_COST']);
// COST_ALLOCATION is the sow's lactation cost handed to her litter at weaning: it leaves her, and the litter's lot (a batch-level row) takes it.
const EXITS = new Set<BioEvent>(['MORTALITY', 'TRANSFORMATION', 'COST_ALLOCATION']);

export interface AnimalValue {
  acquisition: number;
  /** Feed, medicine and overhead capitalised into her while she was pre-mature (the part the batch and the GL hold). */
  capitalised: number;
  /** Accumulated amortisation, positive. */
  amortised: number;
  fairValue: number;
  /** What has left her ledger (a death, a sale, a cull), as a negative number. */
  exits: number;
  bookValue: number;
  /** True when she has at least one row to derive from; false means the figure above is nil, not known. */
  hasRows: boolean;
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** Pure: the sums of one animal's ledger rows, by event, as the value components. */
export function summariseAnimalValue(rows: Array<{ event: BioEvent | null; total: number | string | null }>): AnimalValue {
  const v: AnimalValue = { acquisition: 0, capitalised: 0, amortised: 0, fairValue: 0, exits: 0, bookValue: 0, hasRows: false };
  for (const r of rows) {
    if (!r.event || !BOOK_VALUE_EVENTS.includes(r.event)) continue;
    const amount = Number(r.total ?? 0);
    v.hasRows = true;
    v.bookValue += amount;
    if (r.event === 'ACQUISITION') v.acquisition += amount;
    else if (CAPITALISED.has(r.event)) v.capitalised += amount;
    else if (r.event === 'AMORTIZATION') v.amortised -= amount;
    else if (r.event === 'FAIR_VALUE_ADJMT') v.fairValue += amount;
    else if (EXITS.has(r.event)) v.exits += amount;
  }
  return {
    acquisition: round4(v.acquisition), capitalised: round4(v.capitalised), amortised: round4(v.amortised),
    fairValue: round4(v.fairValue), exits: round4(v.exits), bookValue: round4(v.bookValue), hasRows: v.hasRows,
  };
}

@Injectable()
export class AnimalBookValueService {
  constructor(private readonly cls: ClsService) {}

  private get db(): MySql2Database<typeof schema> {
    const db = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('Tenant database connection context not established.');
    return db;
  }

  /** One grouped query for any number of animals. An animal with no ledger rows is in the map with hasRows false. */
  async valuesFor(animalIds: string[], asOf?: string): Promise<Map<string, AnimalValue>> {
    const out = new Map<string, AnimalValue>();
    const ids = [...new Set(animalIds.filter(Boolean))];
    for (const id of ids) out.set(id, summariseAnimalValue([]));
    if (!ids.length) return out;
    const L = schema.bioAssetLedger;
    const rows = await this.db
      .select({ animal_id: L.animal_id, entry_type: L.entry_type, transaction_type: L.transaction_type, document_type: L.document_type, total: sql<string>`COALESCE(SUM(${L.cost_amount}), 0)` })
      .from(L)
      .where(and(inArray(L.animal_id, ids), bioEventsCondition(L, BOOK_VALUE_EVENTS), ...(asOf ? [lte(L.posting_date, asOf)] : [])))
      .groupBy(L.animal_id, L.entry_type, L.transaction_type, L.document_type);
    const byAnimal = new Map<string, Array<{ event: BioEvent | null; total: string }>>();
    for (const r of rows) {
      if (!r.animal_id) continue;
      byAnimal.set(r.animal_id, [...(byAnimal.get(r.animal_id) ?? []), { event: bioEventOf(r), total: r.total }]);
    }
    for (const [id, list] of byAnimal) out.set(id, summariseAnimalValue(list));
    return out;
  }

  async valueOf(animalId: string, asOf?: string): Promise<AnimalValue> {
    return (await this.valuesFor([animalId], asOf)).get(animalId)!;
  }

  /**
   * Writes the derived figures into animal_register (book_value, total_amortised, current_bio_asset_value) so the
   * readers that still look at the columns (transfers, the financial reports) see the ledger's number. An animal
   * with no ledger rows keeps what the column holds.
   */
  async refreshCache(animalIds: string[]): Promise<void> {
    const values = await this.valuesFor(animalIds);
    for (const [animalId, v] of values) {
      if (!v.hasRows) continue;
      await this.db
        .update(schema.animalRegister)
        .set({
          book_value: v.bookValue.toFixed(4),
          total_amortised: v.amortised.toFixed(4),
          current_bio_asset_value: v.bookValue.toFixed(4),
        })
        .where(eq(schema.animalRegister.animal_id, animalId));
    }
  }
}
