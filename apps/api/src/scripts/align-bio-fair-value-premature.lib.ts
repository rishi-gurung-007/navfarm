/**
 * Pure planner for the BIO_FAIR_VALUE_PREMATURE GL mapping (bio-asset costing, Phase 1 fix X3).
 *
 * A fair-value change on a pre-mature herd must hit the pre-mature asset account, not the mature one. The new
 * transaction type is seeded for new tenants (starter-master-data.seed-data.ts); an existing tenant needs a row
 * per BIO_FAIR_VALUE mapping it already has. The debit account is not hard-coded: it is the CREDIT of the same
 * scope's BIO_TRANSFORMATION mapping (Dr mature asset / Cr pre-mature asset), i.e. whatever pre-mature asset
 * account that company already uses.
 */
export interface MappingRow {
  mapping_id: string;
  tenant_id: string;
  company_id: string | null;
  transaction_type: string;
  nob_id: string | null;
  lob_id: string | null;
  stage_id: string | null;
  item_category_id: string | null;
  valuation_method: string | null;
  debit_gl_account_id: string | null;
  credit_gl_account_id: string | null;
}

export interface PlannedMapping {
  tenant_id: string;
  company_id: string | null;
  nob_id: string | null;
  lob_id: string | null;
  stage_id: string | null;
  item_category_id: string | null;
  valuation_method: string | null;
  transaction_type: 'BIO_FAIR_VALUE_PREMATURE';
  debit_gl_account_id: string;
  credit_gl_account_id: string;
  copied_from: string;
}

export interface Plan {
  inserts: PlannedMapping[];
  skipped: Array<{ mapping_id: string; reason: string }>;
}

const scope = (r: MappingRow) =>
  [r.tenant_id, r.company_id, r.nob_id, r.lob_id, r.stage_id, r.item_category_id, r.valuation_method].join('|');

export function planPrematureFairValue(rows: MappingRow[]): Plan {
  const byType = (t: string) => rows.filter((r) => r.transaction_type === t);
  const existing = new Set(byType('BIO_FAIR_VALUE_PREMATURE').map(scope));
  const transformation = new Map(byType('BIO_TRANSFORMATION').map((r) => [scope(r), r]));
  const plan: Plan = { inserts: [], skipped: [] };
  for (const fv of byType('BIO_FAIR_VALUE')) {
    if (existing.has(scope(fv))) { plan.skipped.push({ mapping_id: fv.mapping_id, reason: 'already has a pre-mature mapping' }); continue; }
    const t = transformation.get(scope(fv));
    if (!t?.credit_gl_account_id) { plan.skipped.push({ mapping_id: fv.mapping_id, reason: 'no BIO_TRANSFORMATION mapping in the same scope to take the pre-mature account from' }); continue; }
    if (!fv.credit_gl_account_id) { plan.skipped.push({ mapping_id: fv.mapping_id, reason: 'BIO_FAIR_VALUE has no credit account' }); continue; }
    plan.inserts.push({
      tenant_id: fv.tenant_id, company_id: fv.company_id, nob_id: fv.nob_id, lob_id: fv.lob_id, stage_id: fv.stage_id,
      item_category_id: fv.item_category_id, valuation_method: fv.valuation_method,
      transaction_type: 'BIO_FAIR_VALUE_PREMATURE',
      debit_gl_account_id: t.credit_gl_account_id, credit_gl_account_id: fv.credit_gl_account_id,
      copied_from: fv.mapping_id,
    });
  }
  return plan;
}
