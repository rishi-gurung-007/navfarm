import { sql, SQL } from 'drizzle-orm';

/**
 * The documents that were sold: those with a posted "Sale" or "Kill sheet" journal, one row per document and journal
 * date (`doc_key`, `d`, `proceeds`). The one statement of what counts as a sale — the GM Dashboard's sales figures and
 * the Bio Asset Ledger's "Sales only" filter both read it. `from` and `to` bound the journal's posting date.
 */
export function saleDocumentsSql(
  tenantId: string,
  companyId: string | undefined,
  from?: string,
  to?: string,
): SQL {
  return sql`
    SELECT h.source_document_no AS doc_key, h.posting_date AS d,
           SUM(l.debit_amount) AS proceeds
    FROM journal_header h
    JOIN journal_line l ON l.journal_id = h.journal_id
    WHERE h.tenant_id = ${tenantId}
      ${companyId ? sql`AND h.company_id = ${companyId}` : sql``}
      AND h.source_document_type IN (${'BATCH'}, ${'SLAUGHTER_TO'})
      AND h.status = 'POSTED'
      AND (h.description LIKE 'Sale%' OR h.description LIKE 'Kill sheet%')
      ${from ? sql`AND h.posting_date >= ${from}` : sql``}
      ${to ? sql`AND h.posting_date <= ${to}` : sql``}
    GROUP BY h.source_document_no, h.posting_date
  `;
}
