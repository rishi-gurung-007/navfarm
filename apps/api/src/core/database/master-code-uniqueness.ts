/** Explicit table/column identities used by the pre-migration duplicate check.
 * Stage retains its existing per-LOB identity; every other catalog is per scope. */
export const MASTER_CODE_UNIQUE_KEYS: Record<string, string[]> = {
  uom_master: ['uom_code'], species_master: ['species_code'],
  location_master: ['location_code'], location_type_master: ['type_code'],
  item_master: ['item_code'], item_type_master: ['type_code'], item_category_master: ['category_code'],
  item_attribute_master: ['attribute_code'], supplier_master: ['supplier_code'], customer_master: ['customer_code'],
  resource_master: ['resource_code'], disease_master: ['disease_code'], feed_formula_master: ['formula_code'],
  gl_account_master: ['account_code'], cost_center_master: ['cost_center_code'],
  no_series: ['code'], stage_master: ['lob_id', 'stage_code'],
};

/**
 * Deliberately absent: medicine_master, uom_conversion_master, gl_mapping_master
 * and breed_lifecycle_stages. Each carries a uq_<table>_scope_code index in
 * schema.ts and is protected by it exactly like the tables above — but their code
 * columns are NULLABLE while the client's numbering conventions are outstanding,
 * and a UNIQUE index does not constrain rows whose key contains NULL. Listing them
 * here would break the two consumers, which both assume a NOT NULL code:
 * verify-demo-master-integrity.ts asserts MySQL REJECTS a duplicated row (it will
 * not, for NULL codes), and align-demo-bbp-masters.ts groups on `company_id`, which
 * breed_lifecycle_stages does not have. Add them here once a series is configured
 * for each and the columns are backfilled and made NOT NULL.
 *
 * Also deliberately absent: breed_master. It carried a scoped unique index while
 * Breed had a farm (Farm + Breed Code was the identity — the same breed name was
 * meant to recur once per farm), but Farm was removed from Breed entirely and the
 * index was dropped with it (migration 0110). breed_code is no longer expected to
 * be unique at any scope: real historical rows already share a code across what
 * used to be different farms (TN-70-Sow x7 in the seeded data, for one), and
 * re-imposing uniqueness at (tenant, company) would reject that pre-existing,
 * valid data rather than anything this change actually removed. breed_id remains
 * the real identity every reference (animal, batch, transfer) already uses.
 */
