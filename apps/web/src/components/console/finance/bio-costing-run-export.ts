import { escapeCsvCell } from '@/modules/master-data/utils/master-csv';

type Row = Record<string, any>;

/**
 * The costing runs as a flat file for reconciliation: one row per animal per run, with the run's own figures (its total and the journal it posted) repeated on each row,
 * so Finance can total a run's rows and tie them to the journal, or total a month and tie it to the ledger. The amounts are the API's, as stored (plain numbers, no
 * thousands separators). For amortisation `Charge` is the expense and the book value falls by it; for fair value it is the gain (+) or loss (-) and the book value rises by it.
 */
export const RUN_CSV_HEADERS = [
  'Run no', 'Period', 'Period start', 'Period end', 'Method', 'Item', 'Batch', 'Run status', 'Run total', 'Journal id', 'Posted at',
  'Animal', 'Line status', 'Skip reason', 'Days costed', 'Days left', 'Book value before', 'Residual', 'Charge / gain-loss', 'Book value after',
  'Costing start', 'Life end',
] as const;

const day = (v: unknown) => (v ? String(v).slice(0, 10) : '');

export function buildRunsCsv(runs: Row[], details: Record<string, Row>, batchLabel: (id?: string | null) => string): string {
  const out: string[] = [RUN_CSV_HEADERS.join(',')];
  for (const r of runs) {
    const lines: Row[] = details[r.run_id]?.lines ?? [];
    for (const l of lines) {
      const cells = [
        r.run_no, r.period_key, day(r.period_start), day(r.period_end), r.method, r.subject_code, batchLabel(r.batch_id), r.status, r.total_charge, r.journal_id,
        r.posted_at ? String(r.posted_at).slice(0, 19).replace('T', ' ') : '',
        l.animal_code, l.status, l.skip_reason, l.days, l.remaining_days, l.book_value_before, l.residual, l.charge, l.book_value_after,
        day(l.costing_start_date), day(l.life_end_date),
      ];
      out.push(cells.map(escapeCsvCell).join(','));
    }
  }
  return out.join('\r\n');
}
