import { and, eq, inArray, or, type SQL } from 'drizzle-orm';
import { BadRequestException } from '@nestjs/common';
import * as schema from '../../../core/database/schema';
import {
  ENTRY_TYPES_BY_TRANSACTION_TYPE,
  INVENTORY_ENTRY_TYPES,
  INVENTORY_TRANSACTION_TYPES,
  type InventoryEntryType,
  type InventoryTransactionType,
} from '../inventory-ledger/inventory-ledger.types';

/**
 * The Bio Asset Ledger's vocabulary — the same two lists as the Inventory Ledger, nothing else:
 *
 *   entry type        POSITIVE, NEGATIVE, TRANSFER, OVERHEAD, DESCRIPTIVE
 *   transaction type  PURCHASE, CONSUMPTION, OUTPUT, TRANSFER_SHIPMENT, TRANSFER_RECEIPT, SALES, VARIANCE_POSITIVE, VARIANCE_NEGATIVE
 *                     (and OVERHEAD / DESCRIPTIVE for rows that only carry a cost or a note)
 *
 * Several different events share one pair of codes (an amortisation charge, a fair-value loss and a death are all NEGATIVE +
 * VARIANCE_NEGATIVE), so the DOCUMENT TYPE is what says which event a row is. Every row must carry one.
 *
 * Reports and cost checks think in events — ACQUISITION, CONSUMPTION, AMORTIZATION and so on — which is what the ledger's entry type
 * used to hold. `bioEventOf` reads the event back from a row, and `bioEventCondition` is the same thing as a query condition, so a
 * reader asks "is this an amortisation?" and does not need to know the codes.
 */
export const BIO_ENTRY_TYPES = INVENTORY_ENTRY_TYPES;
export const BIO_TRANSACTION_TYPES = INVENTORY_TRANSACTION_TYPES;

/** The document behind a Bio Asset Ledger row. */
export const BIO_DOCUMENT_TYPES = {
  GOODS_RECEIPT: 'GOODS_RECEIPT',
  ANIMAL_REGISTRATION: 'ANIMAL_REGISTRATION',
  BATCH: 'BATCH',
  BATCH_OVERHEAD: 'BATCH_OVERHEAD',
  BREEDING_SEMEN: 'BREEDING_SEMEN', // the semen an AI mating used, charged to the sow
  BATCH_TRANSFER: 'BATCH_TRANSFER',
  BATCH_AMORTIZATION: 'BATCH_AMORTIZATION',
  BATCH_FAIR_VALUE: 'BATCH_FAIR_VALUE',
  BATCH_MATURITY: 'BATCH_MATURITY',
  BATCH_HARVEST: 'BATCH_HARVEST',
  BATCH_DISPOSAL: 'BATCH_DISPOSAL',
  ANIMAL_DISPOSAL: 'ANIMAL_DISPOSAL',
  LITTER_BIRTH_COST: 'LITTER_BIRTH_COST',
  LITTER_COST: 'LITTER_COST', // the lactation cost; the name predates the birth-cost document
  GILT_SELECTION: 'GILT_SELECTION',
  MORTALITY: 'MORTALITY',
  BIO_COSTING_RUN: 'BIO_COSTING_RUN',
  BIO_FAIR_VALUE_RUN: 'BIO_FAIR_VALUE_RUN',
  MANUAL_ENTRY: 'MANUAL_ENTRY',
} as const;
export type BioDocumentType = (typeof BIO_DOCUMENT_TYPES)[keyof typeof BIO_DOCUMENT_TYPES];

/** What a row is, in the terms reports use. */
export type BioEvent =
  | 'PURCHASE' // animals received on a goods receipt
  | 'ACQUISITION' // an animal registered, or a batch opened with its animals
  | 'CONSUMPTION' // feed capitalised into the asset
  | 'OVERHEAD_COST' // overhead capitalised into the asset
  | 'COST_ALLOCATION' // litter cost moved from a sow to her piglets
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'AMORTIZATION'
  | 'FAIR_VALUE_ADJMT'
  | 'MORTALITY'
  | 'TRANSFORMATION'; // the asset leaves as something else: a gilt selected, a sale, a harvest — or the maturity marker

export interface BioCodes {
  entry_type: InventoryEntryType;
  transaction_type: InventoryTransactionType;
  document_type: BioDocumentType;
}

const D = BIO_DOCUMENT_TYPES;

/** The codes for each thing the ledger records. Writers use these; nothing writes a code by hand. */
export const bioCodes = {
  /** Animals received on a goods receipt. */
  purchase: (): BioCodes => ({ entry_type: 'POSITIVE', transaction_type: 'PURCHASE', document_type: D.GOODS_RECEIPT }),
  /** A batch opened with its animals: bought, or born on the farm (a farrowing's piglet lot). */
  batchReceipt: (opts: { born: boolean }): BioCodes => ({ entry_type: 'POSITIVE', transaction_type: opts.born ? 'OUTPUT' : 'PURCHASE', document_type: D.BATCH }),
  /** An animal registered, taken from a goods receipt or a litter lot. */
  registration: (): BioCodes => ({ entry_type: 'TRANSFER', transaction_type: 'TRANSFER_RECEIPT', document_type: D.ANIMAL_REGISTRATION }),
  /** Feed capitalised into the asset. */
  feed: (): BioCodes => ({ entry_type: 'OVERHEAD', transaction_type: 'CONSUMPTION', document_type: D.BATCH }),
  /** Overhead capitalised into the asset. */
  overhead: (): BioCodes => ({ entry_type: 'OVERHEAD', transaction_type: 'CONSUMPTION', document_type: D.BATCH_OVERHEAD }),
  /** The cost of the semen an AI mating used, capitalised into the sow: a cost that moves no head. */
  semen: (): BioCodes => ({ entry_type: 'OVERHEAD', transaction_type: 'CONSUMPTION', document_type: D.BREEDING_SEMEN }),
  /** Litter cost leaving a sow (`gives`) or arriving at the litter. `lactation` is the cost over the suckling period, otherwise the cost at birth. */
  costAllocation: (opts: { gives: boolean; lactation: boolean }): BioCodes => ({
    entry_type: 'TRANSFER',
    transaction_type: opts.gives ? 'TRANSFER_SHIPMENT' : 'TRANSFER_RECEIPT',
    document_type: opts.lactation ? D.LITTER_COST : D.LITTER_BIRTH_COST,
  }),
  /** Animals moved from one batch to another. */
  batchTransfer: (opts: { out: boolean }): BioCodes => ({ entry_type: 'TRANSFER', transaction_type: opts.out ? 'TRANSFER_SHIPMENT' : 'TRANSFER_RECEIPT', document_type: D.BATCH_TRANSFER }),
  /** An amortisation charge, from a costing run or from a batch's monthly run. */
  amortisation: (opts: { source: 'RUN' | 'BATCH' }): BioCodes => ({
    entry_type: 'NEGATIVE', transaction_type: 'VARIANCE_NEGATIVE', document_type: opts.source === 'RUN' ? D.BIO_COSTING_RUN : D.BATCH_AMORTIZATION,
  }),
  /** A fair-value gain or loss, from a costing run or from a batch. */
  fairValue: (opts: { source: 'RUN' | 'BATCH'; gain: boolean }): BioCodes => ({
    entry_type: opts.gain ? 'POSITIVE' : 'NEGATIVE',
    transaction_type: opts.gain ? 'VARIANCE_POSITIVE' : 'VARIANCE_NEGATIVE',
    document_type: opts.source === 'RUN' ? D.BIO_FAIR_VALUE_RUN : D.BATCH_FAIR_VALUE,
  }),
  /** A death. */
  mortality: (): BioCodes => ({ entry_type: 'NEGATIVE', transaction_type: 'VARIANCE_NEGATIVE', document_type: D.MORTALITY }),
  /** Animals selected out of a litter lot as gilts (the animals themselves are registered separately). */
  giltSelection: (): BioCodes => ({ entry_type: 'TRANSFER', transaction_type: 'TRANSFER_SHIPMENT', document_type: D.GILT_SELECTION }),
  /** The marker a batch leaves when it is made mature: no cost, no heads leaving. */
  maturity: (): BioCodes => ({ entry_type: 'DESCRIPTIVE', transaction_type: 'DESCRIPTIVE', document_type: D.BATCH_MATURITY }),
  /** Animals harvested out of a bio-asset batch as produce. */
  harvest: (): BioCodes => ({ entry_type: 'NEGATIVE', transaction_type: 'CONSUMPTION', document_type: D.BATCH_HARVEST }),
  /** Animals leaving by sale (`sold`) or by any other disposal, from a batch or from the animal's own record. */
  disposal: (opts: { sold: boolean; scope: 'BATCH' | 'ANIMAL' }): BioCodes => ({
    entry_type: 'NEGATIVE', transaction_type: opts.sold ? 'SALES' : 'CONSUMPTION', document_type: opts.scope === 'BATCH' ? D.BATCH_DISPOSAL : D.ANIMAL_DISPOSAL,
  }),
};

const FLIP_ENTRY: Partial<Record<InventoryEntryType, InventoryEntryType>> = { POSITIVE: 'NEGATIVE', NEGATIVE: 'POSITIVE' };
const FLIP_TRANSACTION: Partial<Record<InventoryTransactionType, InventoryTransactionType>> = {
  VARIANCE_POSITIVE: 'VARIANCE_NEGATIVE', VARIANCE_NEGATIVE: 'VARIANCE_POSITIVE',
  TRANSFER_SHIPMENT: 'TRANSFER_RECEIPT', TRANSFER_RECEIPT: 'TRANSFER_SHIPMENT',
};

/**
 * The codes of the row that offsets `original`: the same document and event, the opposite direction. TRANSFER, OVERHEAD and
 * DESCRIPTIVE rows keep their entry type, since they carry no sign of their own.
 */
export function reverseBioCodes(original: { entry_type: string; transaction_type: string; document_type: string | null }): BioCodes {
  return {
    entry_type: (FLIP_ENTRY[original.entry_type as InventoryEntryType] ?? original.entry_type) as InventoryEntryType,
    transaction_type: (FLIP_TRANSACTION[original.transaction_type as InventoryTransactionType] ?? original.transaction_type) as InventoryTransactionType,
    document_type: (original.document_type ?? D.BATCH) as BioDocumentType,
  };
}

/**
 * The entry types each transaction type may carry here: the Inventory Ledger's map, plus one thing it does not have. Feed or overhead
 * capitalised into an animal is a CONSUMPTION that moves no head, only cost, so it is written as OVERHEAD.
 */
export const BIO_ENTRY_TYPES_BY_TRANSACTION_TYPE: Record<InventoryTransactionType, readonly InventoryEntryType[]> = {
  ...ENTRY_TYPES_BY_TRANSACTION_TYPE,
  CONSUMPTION: ['NEGATIVE', 'OVERHEAD'],
};

/** Refuses a pair of codes the map does not allow, so a manual or imported row cannot invent one. */
export function assertBioMovement(transactionType: string, entryType: string) {
  if (!(BIO_ENTRY_TYPES as readonly string[]).includes(entryType)) {
    throw new BadRequestException(`'${entryType}' is not a Bio Asset Ledger entry type (${BIO_ENTRY_TYPES.join(', ')}).`);
  }
  const allowed = BIO_ENTRY_TYPES_BY_TRANSACTION_TYPE[transactionType as InventoryTransactionType];
  if (!allowed) {
    throw new BadRequestException(`'${transactionType}' is not a Bio Asset Ledger transaction type (${BIO_TRANSACTION_TYPES.join(', ')}).`);
  }
  if (!allowed.includes(entryType as InventoryEntryType)) {
    throw new BadRequestException(`In the Bio Asset Ledger a ${transactionType} entry is written as ${allowed.join(' or ')}, not ${entryType}.`);
  }
}

type CodedRow = { entry_type: string; transaction_type?: string | null; document_type?: string | null };

/** The documents each event is recorded under. ACQUISITION and CONSUMPTION share BATCH and are told apart by entry type (see `bioEventOf`). */
const EVENT_DOCUMENTS: Record<BioEvent, readonly string[]> = {
  PURCHASE: [D.GOODS_RECEIPT],
  ACQUISITION: [D.ANIMAL_REGISTRATION, D.BATCH],
  CONSUMPTION: [D.BATCH],
  OVERHEAD_COST: [D.BATCH_OVERHEAD, D.BREEDING_SEMEN],
  COST_ALLOCATION: [D.LITTER_BIRTH_COST, D.LITTER_COST],
  TRANSFER_OUT: [D.BATCH_TRANSFER],
  TRANSFER_IN: [D.BATCH_TRANSFER],
  AMORTIZATION: [D.BIO_COSTING_RUN, D.BATCH_AMORTIZATION],
  FAIR_VALUE_ADJMT: [D.BIO_FAIR_VALUE_RUN, D.BATCH_FAIR_VALUE],
  MORTALITY: [D.MORTALITY],
  TRANSFORMATION: [D.GILT_SELECTION, D.BATCH_MATURITY, D.BATCH_HARVEST, D.BATCH_DISPOSAL, D.ANIMAL_DISPOSAL],
};

/** What a row is, or null for a row this ledger did not write (a manual entry). */
export function bioEventOf(row: CodedRow): BioEvent | null {
  switch (row.document_type) {
    case D.GOODS_RECEIPT: return 'PURCHASE';
    case D.ANIMAL_REGISTRATION: return 'ACQUISITION';
    case D.BATCH: return row.entry_type === 'OVERHEAD' ? 'CONSUMPTION' : 'ACQUISITION';
    case D.BATCH_OVERHEAD:
    case D.BREEDING_SEMEN: return 'OVERHEAD_COST';
    case D.LITTER_BIRTH_COST:
    case D.LITTER_COST: return 'COST_ALLOCATION';
    case D.BATCH_TRANSFER: return row.transaction_type === 'TRANSFER_SHIPMENT' ? 'TRANSFER_OUT' : 'TRANSFER_IN';
    case D.BIO_COSTING_RUN:
    case D.BATCH_AMORTIZATION: return 'AMORTIZATION';
    case D.BIO_FAIR_VALUE_RUN:
    case D.BATCH_FAIR_VALUE: return 'FAIR_VALUE_ADJMT';
    case D.MORTALITY: return 'MORTALITY';
    case D.GILT_SELECTION:
    case D.BATCH_MATURITY:
    case D.BATCH_HARVEST:
    case D.BATCH_DISPOSAL:
    case D.ANIMAL_DISPOSAL: return 'TRANSFORMATION';
    default: return null;
  }
}

/** The columns a condition reads; the Bio Asset Ledger table, or an alias of it. */
type BioColumns = Pick<typeof schema.bioAssetLedger, 'entry_type' | 'transaction_type' | 'document_type'>;

/** The query condition for one event — the SQL twin of `bioEventOf`. */
export function bioEventCondition(columns: BioColumns, event: BioEvent): SQL {
  const docs = EVENT_DOCUMENTS[event];
  switch (event) {
    case 'ACQUISITION':
      return or(eq(columns.document_type, D.ANIMAL_REGISTRATION), and(eq(columns.document_type, D.BATCH), eq(columns.entry_type, 'POSITIVE')))!;
    case 'CONSUMPTION':
      return and(eq(columns.document_type, D.BATCH), eq(columns.entry_type, 'OVERHEAD'))!;
    case 'TRANSFER_OUT':
      return and(eq(columns.document_type, D.BATCH_TRANSFER), eq(columns.transaction_type, 'TRANSFER_SHIPMENT'))!;
    case 'TRANSFER_IN':
      return and(eq(columns.document_type, D.BATCH_TRANSFER), eq(columns.transaction_type, 'TRANSFER_RECEIPT'))!;
    default:
      return inArray(columns.document_type, [...docs]);
  }
}

/** The condition for any of several events. */
export function bioEventsCondition(columns: BioColumns, events: readonly BioEvent[]): SQL {
  const parts = events.map((event) => bioEventCondition(columns, event));
  return (parts.length === 1 ? parts[0] : or(...parts))!;
}

/** A representative set of codes for an event: what its usual row carries. For tests and seed data, which build rows by event. */
export function bioCodesOfEvent(event: BioEvent): BioCodes {
  switch (event) {
    case 'PURCHASE': return bioCodes.purchase();
    case 'ACQUISITION': return bioCodes.registration();
    case 'CONSUMPTION': return bioCodes.feed();
    case 'OVERHEAD_COST': return bioCodes.overhead();
    case 'COST_ALLOCATION': return bioCodes.costAllocation({ gives: false, lactation: false });
    case 'TRANSFER_OUT': return bioCodes.batchTransfer({ out: true });
    case 'TRANSFER_IN': return bioCodes.batchTransfer({ out: false });
    case 'AMORTIZATION': return bioCodes.amortisation({ source: 'RUN' });
    case 'FAIR_VALUE_ADJMT': return bioCodes.fairValue({ source: 'RUN', gain: true });
    case 'MORTALITY': return bioCodes.mortality();
    case 'TRANSFORMATION': return bioCodes.disposal({ sold: false, scope: 'BATCH' });
  }
}

/**
 * The raw-SQL twin of `bioEventCondition`, for scripts that write their SQL by hand. `alias` is the table's alias in the query.
 * Application code uses `bioEventCondition`; this exists so the two cannot drift apart without a test noticing.
 */
export function bioEventSql(events: BioEvent | readonly BioEvent[], alias: string): string {
  const one = (event: BioEvent): string => {
    const doc = `${alias}.document_type`;
    switch (event) {
      case 'ACQUISITION': return `(${doc} = '${D.ANIMAL_REGISTRATION}' OR (${doc} = '${D.BATCH}' AND ${alias}.entry_type = 'POSITIVE'))`;
      case 'CONSUMPTION': return `(${doc} = '${D.BATCH}' AND ${alias}.entry_type = 'OVERHEAD')`;
      case 'TRANSFER_OUT': return `(${doc} = '${D.BATCH_TRANSFER}' AND ${alias}.transaction_type = 'TRANSFER_SHIPMENT')`;
      case 'TRANSFER_IN': return `(${doc} = '${D.BATCH_TRANSFER}' AND ${alias}.transaction_type = 'TRANSFER_RECEIPT')`;
      default: return `${doc} IN (${EVENT_DOCUMENTS[event].map((d) => `'${d}'`).join(', ')})`;
    }
  };
  const list = Array.isArray(events) ? (events as readonly BioEvent[]) : [events as BioEvent];
  return list.length === 1 ? one(list[0]) : `(${list.map(one).join(' OR ')})`;
}

export { ENTRY_TYPES_BY_TRANSACTION_TYPE };
