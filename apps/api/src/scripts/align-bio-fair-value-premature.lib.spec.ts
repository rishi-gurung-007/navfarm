import { MappingRow, planPrematureFairValue } from './align-bio-fair-value-premature.lib';

const row = (o: Partial<MappingRow>): MappingRow => ({
  mapping_id: 'm', tenant_id: 't', company_id: 'c', transaction_type: 'BIO_FAIR_VALUE', nob_id: 'n', lob_id: 'l',
  stage_id: null, item_category_id: null, valuation_method: null, debit_gl_account_id: 'A-MATURE', credit_gl_account_id: 'A-FV', ...o,
});

describe('planPrematureFairValue', () => {
  it('debits the pre-mature account taken from the same scope\'s BIO_TRANSFORMATION credit', () => {
    const plan = planPrematureFairValue([
      row({ mapping_id: 'fv' }),
      row({ mapping_id: 'tr', transaction_type: 'BIO_TRANSFORMATION', debit_gl_account_id: 'A-MATURE', credit_gl_account_id: 'A-PRE' }),
    ]);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]).toMatchObject({ debit_gl_account_id: 'A-PRE', credit_gl_account_id: 'A-FV', copied_from: 'fv', transaction_type: 'BIO_FAIR_VALUE_PREMATURE' });
  });

  it('is idempotent: a scope that already has the mapping is skipped', () => {
    const plan = planPrematureFairValue([
      row({ mapping_id: 'fv' }),
      row({ mapping_id: 'tr', transaction_type: 'BIO_TRANSFORMATION', credit_gl_account_id: 'A-PRE' }),
      row({ mapping_id: 'done', transaction_type: 'BIO_FAIR_VALUE_PREMATURE', debit_gl_account_id: 'A-PRE' }),
    ]);
    expect(plan.inserts).toEqual([]);
    expect(plan.skipped[0].reason).toMatch(/already/);
  });

  it('refuses to guess an account when the scope has no BIO_TRANSFORMATION', () => {
    const plan = planPrematureFairValue([row({ mapping_id: 'fv' }), row({ mapping_id: 'tr', transaction_type: 'BIO_TRANSFORMATION', nob_id: 'other' })]);
    expect(plan.inserts).toEqual([]);
    expect(plan.skipped[0].reason).toMatch(/BIO_TRANSFORMATION/);
  });
});
