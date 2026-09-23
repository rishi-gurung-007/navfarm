/** Explicit mapping: GL/account_code and feed formula/formula_code are not
 * derivable by appending _code to the master name. UUID-only joins are absent. */
export const MASTER_CODE_COLUMNS: Record<string, string> = {
  ITEM: 'item_code', ITEM_TYPE: 'type_code', ITEM_CATEGORY: 'category_code',
  ITEM_ATTRIBUTE: 'attribute_code', LOCATION: 'location_code', LOCATION_TYPE: 'type_code',
  BREED: 'breed_code', SPECIES: 'species_code', UOM: 'uom_code', STAGE: 'stage_code',
  SUPPLIER: 'supplier_code', CUSTOMER: 'customer_code', RESOURCE: 'resource_code',
  REASON: 'reason_code', DISEASE: 'disease_code', FEED_FORMULA: 'formula_code',
  GL_ACCOUNT: 'account_code', COST_CENTER: 'cost_center_code', ANIMAL: 'animal_code',
  // Nullable identities: these three had no code column at all until the client's
  // numbering conventions were asked for. They are listed here so a series can be
  // configured later without another code change; until one is, the column simply
  // stays NULL or holds a manually typed code.
  // Medicine is deliberately absent — it is a per-item profile, not a master, and
  // is identified by its item's code (BBP-1 §1.5).
  UOM_CONVERSION: 'conversion_code',
  GL_MAPPING: 'mapping_code', BREED_LIFECYCLE_STAGE: 'lifecycle_code',
  KPI_METRIC: 'metric_code',
};
