import { escapeCsvCell } from '@/modules/master-data/utils/master-csv';

type Row = Record<string, any>;

export const LEDGER_CSV_HEADERS = [
  'Animal', 'Posting date', 'Entry type', 'Treatment', 'Item', 'Document', 'Reference', 'Quantity', 'UOM', 'Unit cost / rate', 'Amount', 'Journal entry', 'Journal id',
] as const;

/**
 * An animal's postings as a flat file for reconciliation: one row per posting, the capitalised ones and the expensed ones, each with its journal number so Finance can
 * tie a row to the journal and the journal to the GL. `Treatment` says whether the posting is in her book value (Capitalised, Amortisation, Fair value, ...) or charged to
 * expense (Expensed); only the first kind adds up to her net. Amounts are as stored, with the sign the ledger gives them.
 */
export function buildLedgerCsv(entries: Row[], label: (entry: Row) => string, animalCode: string): string {
  const out: string[] = [LEDGER_CSV_HEADERS.join(',')];
  for (const e of entries) {
    const cells = [
      animalCode,
      String(e.posting_date ?? '').slice(0, 10),
      label(e),
      e.expensed ? 'Expensed' : 'In book value',
      e.item_code ? `${e.item_code}${e.item_name ? ` ${e.item_name}` : ''}` : '',
      e.document_type,
      e.document_no,
      e.quantity,
      e.uom,
      e.cost_amount_each_unit ?? e.unit_cost,
      e.cost_amount ?? e.amount,
      e.journal_no,
      e.journal_id,
    ];
    out.push(cells.map(escapeCsvCell).join(','));
  }
  return out.join('\r\n');
}
