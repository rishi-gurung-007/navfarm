export interface LedgerRowFacts {
  entry_id: string;
  document_no: string | null;
  run_id: string | null;
  posting_date: unknown;
  cost_amount: unknown;
  bio_asset_item_id: string;
  /** Feed or overhead charged to expense (the animal was past her costing start), so its journal debits an expense account, not her asset account. */
  expensed?: boolean;
}

export interface JournalFacts {
  journal_id: string;
  journal_no: string;
  posting_date: unknown;
  source_document_no: string | null;
  /** The accounts the journal debits, with what each is debited. */
  debits: Array<{ gl_account_id: string; amount: number }>;
}

export interface JournalLink {
  journal_id: string;
  journal_no: string;
}

const day = (value: unknown) => String(value ?? '').slice(0, 10);

/**
 * The journal a bio-asset ledger row was posted with. A costing run's rows name their run, and the run's number is the journal's document;
 * every other row names its document (a batch, a goods receipt) and the day. One feed issue journals the whole group of animals that took it,
 * so several journals can share a document and a day: the one that debits this animal's own acquisition account for at least her share is hers,
 * and failing that the journal with a debit of that size elsewhere (the expense journal of an animal past its costing start).
 */
export function linkLedgerJournals(
  rows: LedgerRowFacts[],
  journals: JournalFacts[],
  runNos: Map<string, string>,
  acquisitionAccountOf: Map<string, string | null>,
): Map<string, JournalLink> {
  const links = new Map<string, JournalLink>();
  for (const row of rows) {
    const document = row.run_id ? runNos.get(row.run_id) : row.document_no;
    if (!document) continue;
    const sameDocument = journals.filter((j) => j.source_document_no === document);
    const sameDay = row.run_id ? sameDocument : sameDocument.filter((j) => day(j.posting_date) === day(row.posting_date));
    if (sameDay.length === 0) continue;
    let pick = sameDay[0];
    if (sameDay.length > 1) {
      const share = Math.abs(Number(row.cost_amount ?? 0)) - 0.005;
      const account = acquisitionAccountOf.get(row.bio_asset_item_id);
      const capitalised = account ? sameDay.find((j) => j.debits.some((d) => d.gl_account_id === account && d.amount >= share)) : undefined;
      const expensed = sameDay.find((j) => j.debits.some((d) => d.gl_account_id !== account && d.amount >= share));
      pick = (row.expensed ? expensed ?? capitalised : capitalised ?? expensed) ?? sameDay[0];
    }
    links.set(row.entry_id, { journal_id: pick.journal_id, journal_no: pick.journal_no });
  }
  return links;
}
