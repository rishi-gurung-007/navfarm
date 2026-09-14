/**
 * System-generated, tenant-wide reference master data.
 *
 * These are seeded into every tenant database (company_id left null) so
 * companies get a standard starting catalog instead of typing "KG" or
 * "Chicken" from scratch. Companies can still add their own company-scoped
 * entries alongside these via the normal master-data APIs.
 */

import { BBP_STAGE_SEED, BBP_STAGE_RENAMES } from './piggery-bbp-stage-seed';

export const SYSTEM_UOM_SEED: Array<{
  uom_code: string;
  uom_name: string;
  uom_type: string;
  decimal_places: number;
  is_base_uom: boolean;
}> = [
  { uom_code: 'KG', uom_name: 'Kilogram', uom_type: 'WEIGHT', decimal_places: 3, is_base_uom: true },
  { uom_code: 'GRAM', uom_name: 'Gram', uom_type: 'WEIGHT', decimal_places: 0, is_base_uom: false },
  { uom_code: 'TONNE', uom_name: 'Metric Tonne', uom_type: 'WEIGHT', decimal_places: 3, is_base_uom: false },
  { uom_code: 'LITER', uom_name: 'Litre', uom_type: 'VOLUME', decimal_places: 3, is_base_uom: true },
  { uom_code: 'ML', uom_name: 'Millilitre', uom_type: 'VOLUME', decimal_places: 0, is_base_uom: false },
  // Units the rest of the master data already referenced but the UOM master did
  // not contain, so their dropdowns rendered blank and the value could not be
  // re-selected: 15 pens and 6 livestock items are measured in HEAD, medicines
  // come in VIAL/PACK, vaccines in DOSE, and vehicle/utility resources bill in
  // KM/KWH. HEAD is the unit a piggery counts in, so its absence was the most
  // visible of these.
  //
  // KM and KWH are OTHER: the type list is WEIGHT/VOLUME/COUNT/AREA/TIME/OTHER,
  // and adding a distance or energy type for two units is not worth the churn.
  { uom_code: 'HEAD', uom_name: 'Head', uom_type: 'COUNT', decimal_places: 0, is_base_uom: false },
  { uom_code: 'DOSE', uom_name: 'Dose', uom_type: 'COUNT', decimal_places: 0, is_base_uom: false },
  { uom_code: 'VIAL', uom_name: 'Vial', uom_type: 'COUNT', decimal_places: 0, is_base_uom: false },
  { uom_code: 'PACK', uom_name: 'Pack', uom_type: 'COUNT', decimal_places: 0, is_base_uom: false },
  { uom_code: 'KM', uom_name: 'Kilometre', uom_type: 'OTHER', decimal_places: 2, is_base_uom: false },
  { uom_code: 'KWH', uom_name: 'Kilowatt Hour', uom_type: 'OTHER', decimal_places: 2, is_base_uom: false },
  { uom_code: 'PCS', uom_name: 'Pieces', uom_type: 'COUNT', decimal_places: 0, is_base_uom: true },
  { uom_code: 'DOZEN', uom_name: 'Dozen', uom_type: 'COUNT', decimal_places: 0, is_base_uom: false },
  { uom_code: 'BOX', uom_name: 'Box', uom_type: 'COUNT', decimal_places: 0, is_base_uom: false },
  { uom_code: 'BAG', uom_name: 'Bag', uom_type: 'COUNT', decimal_places: 0, is_base_uom: false },
  { uom_code: 'SQFT', uom_name: 'Square Feet', uom_type: 'AREA', decimal_places: 2, is_base_uom: true },
  { uom_code: 'SQM', uom_name: 'Square Meter', uom_type: 'AREA', decimal_places: 2, is_base_uom: false },
  { uom_code: 'HR', uom_name: 'Hour', uom_type: 'TIME', decimal_places: 2, is_base_uom: true },
  { uom_code: 'DAY', uom_name: 'Day', uom_type: 'TIME', decimal_places: 0, is_base_uom: false },
];

// Real codes already in use across the seeded demo data (RAW_MATERIAL, CONSUMABLE, FEED,
// LIVESTOCK, FINISHED_GOODS) plus MEDICINE/VACCINE (item.service.ts's withdrawal_days check
// branches on these two literal strings), rounded out with the spec's remaining documented
// types (SEMI_FINISHED, BY_PRODUCT, OVERHEAD) that aren't in use yet.
// code_prefix defaults to each row's own type_code — same backfill rule migration
// 0060 applied to existing tenants' rows (see NumberSeriesService.resolveSeriesFor's
// doc comment: an ITEM_<type_code> series defers to this prefix over its own).
export const SYSTEM_ITEM_TYPE_SEED: Array<{
  type_code: string;
  type_name: string;
  code_prefix: string;
  description?: string;
}> = [
  { type_code: 'RAW_MATERIAL', type_name: 'Raw Material', code_prefix: 'RAW_MATERIAL', description: 'Unprocessed input consumed in production (feed ingredients, chemicals, etc.).' },
  { type_code: 'CONSUMABLE', type_name: 'Consumable', code_prefix: 'CONSUMABLE', description: 'General consumable stock — not a raw material line item.' },
  { type_code: 'FEED', type_name: 'Feed', code_prefix: 'FEED', description: 'Formulated animal feed.' },
  { type_code: 'MEDICINE', type_name: 'Medicine', code_prefix: 'MEDICINE', description: 'Medicine — requires withdrawal_days before a treated animal may be slaughtered.' },
  { type_code: 'VACCINE', type_name: 'Vaccine', code_prefix: 'VACCINE', description: 'Vaccine — requires withdrawal_days before a treated animal may be slaughtered.' },
  { type_code: 'LIVESTOCK', type_name: 'Livestock', code_prefix: 'LIVESTOCK', description: 'Living biological asset (animal) tracked as inventory.' },
  { type_code: 'SEMI_FINISHED', type_name: 'Semi-Finished Good', code_prefix: 'SEMI_FINISHED', description: 'Partially processed output, consumed further downstream.' },
  { type_code: 'FINISHED_GOODS', type_name: 'Finished Goods', code_prefix: 'FINISHED_GOODS', description: 'Final saleable output.' },
  { type_code: 'BY_PRODUCT', type_name: 'By-Product', code_prefix: 'BY_PRODUCT', description: 'Secondary output generated alongside the main product.' },
  { type_code: 'OVERHEAD', type_name: 'Overhead', code_prefix: 'OVERHEAD', description: 'Non-physical cost item (labor, utilities) with no stock quantity.' },
];

/**
 * Location classifications from the client Location Master template. The
 * semantic type code is stable; users may change the prefix used for future
 * generated location identities without renaming existing locations.
 */
export const SYSTEM_LOCATION_TYPE_SEED: Array<{
  type_code: string;
  type_name: string;
  code_prefix: string;
  allowed_parent_types: string[];
}> = [
  { type_code: 'FARM', type_name: 'Farm', code_prefix: 'FARM', allowed_parent_types: [] },
  { type_code: 'SHED', type_name: 'Shed / House', code_prefix: 'SHED', allowed_parent_types: ['FARM'] },
  { type_code: 'PEN', type_name: 'Pen', code_prefix: 'PEN', allowed_parent_types: ['SHED'] },
  // Porta's Location Master has 89 rows of type CRATE — farrowing and
  // service-line crates, under its houses, capacity 1. Not folded into CAGE,
  // which is poultry vocabulary and would make the screens say something the
  // farm does not; not folded into PEN either, because the capacity data
  // separates them plainly: a crate holds one animal, a pen holds 34 to 39.
  { type_code: 'CRATE', type_name: 'Crate', code_prefix: 'CRATE', allowed_parent_types: ['SHED'] },
  { type_code: 'CAGE', type_name: 'Cage', code_prefix: 'CAGE', allowed_parent_types: ['FARM', 'SHED'] },
  { type_code: 'STORE', type_name: 'Store', code_prefix: 'STORE', allowed_parent_types: ['FARM'] },
  { type_code: 'QUARANTINE', type_name: 'Quarantine', code_prefix: 'QUAR', allowed_parent_types: ['FARM', 'SHED'] },
  { type_code: 'SILO', type_name: 'Silo', code_prefix: 'SILO', allowed_parent_types: ['FARM', 'SHED'] },
];

export const SYSTEM_SPECIES_SEED: Array<{
  species_code: string;
  species_name: string;
}> = [
  { species_code: 'CHICKEN', species_name: 'Chicken' },
  { species_code: 'DUCK', species_name: 'Duck' },
  { species_code: 'TURKEY', species_name: 'Turkey' },
  { species_code: 'QUAIL', species_name: 'Quail' },
  { species_code: 'CATTLE', species_name: 'Cattle' },
  { species_code: 'BUFFALO', species_name: 'Buffalo' },
  { species_code: 'GOAT', species_name: 'Goat' },
  { species_code: 'SHEEP', species_name: 'Sheep' },
  { species_code: 'PIG', species_name: 'Pig' },
  { species_code: 'FISH', species_name: 'Fish' },
  { species_code: 'SHRIMP', species_name: 'Shrimp' },
  // HONEY_BEE, not BEE: the SPECIES series is named on species_name, and this
  // was the one row of twelve whose code was not already what that produces.
  { species_code: 'HONEY_BEE', species_name: 'Honey Bee' },
];

/**
 * One representative breed per applicable LOB (breed_master.nob_id is
 * required, lob_id scopes it further — see breed.service.ts's wildcard
 * matching for lob_id: null). company_id is left null at insert time so
 * these are visible to every company in the tenant, same as UOM/species
 * above. Not exhaustive — just enough that every LOB's Breed dropdown has a
 * real starting option instead of being empty.
 */
export const SYSTEM_BREED_SEED: Array<{
  nob_code: string;
  lob_code: string;
  breed_code: string;
  breed_name: string;
  species_code: string;
  breed_type: string;
  // Piggery-specific standards — from the spec's Breed Master Template example row for
  // LARGE_WHITE, which applies directly here: Large White and Yorkshire are the same
  // breed under two regional names. Left undefined for every other seeded breed rather
  // than invented.
  gestation_days?: number;
  lactation_days?: number;
  productive_life_months?: number;
  residual_value_pct?: number;
  productive_life_cycles?: number;
  avg_litter_size_born?: number;
  avg_litter_size_weaned?: number;
  avg_weaning_weight_kg?: number;
  farrowing_rate_pct?: number;
  boar_doses_per_week?: number;
  boar_productive_life_months?: number;
}> = [
  { nob_code: 'POULTRY', lob_code: 'PLT_REARING', breed_code: 'COBB-500', breed_name: 'Cobb 500', species_code: 'CHICKEN', breed_type: 'BROILER' },
  { nob_code: 'POULTRY', lob_code: 'PLT_LAYING', breed_code: 'BOVANS-WHITE', breed_name: 'Bovans White', species_code: 'CHICKEN', breed_type: 'LAYER' },
  { nob_code: 'POULTRY', lob_code: 'PLT_HATCHING', breed_code: 'ROSS-308', breed_name: 'Ross 308', species_code: 'CHICKEN', breed_type: 'BREEDER' },
  { nob_code: 'POULTRY', lob_code: 'PLT_CB', breed_code: 'COBB-500-CB', breed_name: 'Cobb 500 (Commercial Broiler)', species_code: 'CHICKEN', breed_type: 'BROILER' },
  { nob_code: 'LIVESTOCK', lob_code: 'LVS_MILKING', breed_code: 'HOLSTEIN-FRIESIAN', breed_name: 'Holstein Friesian', species_code: 'CATTLE', breed_type: 'DAIRY' },
  {
    nob_code: 'LIVESTOCK', lob_code: 'LVS_PIGGERY', breed_code: 'YORKSHIRE', breed_name: 'Yorkshire', species_code: 'PIG', breed_type: 'MEAT',
    gestation_days: 114, lactation_days: 28, productive_life_months: 36, residual_value_pct: 10.00,
    productive_life_cycles: 7, avg_litter_size_born: 11.50, avg_litter_size_weaned: 10.00,
    avg_weaning_weight_kg: 7.000, farrowing_rate_pct: 85.00, boar_doses_per_week: 4.00, boar_productive_life_months: 24,
  },
  {
    // Large White is the European name for the same genetic line as Yorkshire; shares all the same
    // production standards. Seeded separately because clients may register animals under either name.
    nob_code: 'LIVESTOCK', lob_code: 'LVS_PIGGERY', breed_code: 'LARGE_WHITE', breed_name: 'Large White', species_code: 'PIG', breed_type: 'MEAT',
    gestation_days: 114, lactation_days: 28, productive_life_months: 36, residual_value_pct: 10.00,
    productive_life_cycles: 7, avg_litter_size_born: 11.50, avg_litter_size_weaned: 10.00,
    avg_weaning_weight_kg: 7.000, farrowing_rate_pct: 85.00, boar_doses_per_week: 4.00, boar_productive_life_months: 24,
  },
  {
    // Landrace: prolific maternal breed, slightly longer gestation, larger litters.
    nob_code: 'LIVESTOCK', lob_code: 'LVS_PIGGERY', breed_code: 'LANDRACE', breed_name: 'Landrace', species_code: 'PIG', breed_type: 'MEAT',
    gestation_days: 115, lactation_days: 28, productive_life_months: 36, residual_value_pct: 10.00,
    productive_life_cycles: 7, avg_litter_size_born: 12.00, avg_litter_size_weaned: 10.50,
    avg_weaning_weight_kg: 6.500, farrowing_rate_pct: 87.00, boar_doses_per_week: 4.00, boar_productive_life_months: 24,
  },
  {
    // Duroc: terminal sire breed, faster growth, high meat yield — lower litter size.
    nob_code: 'LIVESTOCK', lob_code: 'LVS_PIGGERY', breed_code: 'DUROC', breed_name: 'Duroc', species_code: 'PIG', breed_type: 'MEAT',
    gestation_days: 114, lactation_days: 27, productive_life_months: 30, residual_value_pct: 10.00,
    productive_life_cycles: 6, avg_litter_size_born: 10.00, avg_litter_size_weaned: 8.50,
    avg_weaning_weight_kg: 7.500, farrowing_rate_pct: 82.00, boar_doses_per_week: 5.00, boar_productive_life_months: 30,
  },
  { nob_code: 'LIVESTOCK', lob_code: 'LVS_GOAT_SHEEP', breed_code: 'BOER-GOAT', breed_name: 'Boer Goat', species_code: 'GOAT', breed_type: 'MEAT' },
  { nob_code: 'AQUA', lob_code: 'AQA_FISH', breed_code: 'ROHU', breed_name: 'Rohu', species_code: 'FISH', breed_type: 'FISH' },
  { nob_code: 'INSECT', lob_code: 'INS_BEE', breed_code: 'ITALIAN-BEE', breed_name: 'Italian Honey Bee', species_code: 'BEE', breed_type: 'DUAL_PURPOSE' },
];

/**
 * A couple of representative items per LOB (input + main output), scoped by
 * nob_id/lob_id the same way batch-panel.tsx's item picker filters. Again,
 * company_id is left null (tenant-wide). item_type follows the values the
 * batch/inventory modules already recognize (RAW_MATERIAL / FINISHED_GOODS).
 */
/**
 * Lines of business the seed actually provisions master data for.
 *
 * Only piggery is in scope; the other fifteen have lob_master rows (they are
 * the taxonomy) but no stages, screens or working flows, so seeding their
 * items, breeds and parameters only produced noise in every picker. Their
 * definitions stay in the constants below — enabling one later is an entry
 * here, not a re-typing job.
 */
export const SEEDED_LOB_CODES = ['LVS_PIGGERY'] as const;

/** Narrows any LOB-scoped seed constant to the lines of business in scope. */
export function forSeededLobs<T extends { lob_code: string }>(rows: readonly T[]): T[] {
  return rows.filter((row) => (SEEDED_LOB_CODES as readonly string[]).includes(row.lob_code));
}

export const SYSTEM_ITEM_SEED: Array<{
  nob_code: string;
  lob_code: string;
  item_code: string;
  item_name: string;
  item_type: string;
  uom_primary: string;
}> = [
  { nob_code: 'POULTRY', lob_code: 'PLT_REARING', item_code: 'PLT-DOC', item_name: 'Day-Old Chick', item_type: 'RAW_MATERIAL', uom_primary: 'PCS' },
  { nob_code: 'POULTRY', lob_code: 'PLT_REARING', item_code: 'PLT-STARTER-FEED', item_name: 'Starter Feed', item_type: 'RAW_MATERIAL', uom_primary: 'KG' },
  { nob_code: 'POULTRY', lob_code: 'PLT_LAYING', item_code: 'PLT-POL-PULLET', item_name: 'Point-of-Lay Pullet', item_type: 'RAW_MATERIAL', uom_primary: 'PCS' },
  { nob_code: 'POULTRY', lob_code: 'PLT_LAYING', item_code: 'PLT-LAYER-FEED', item_name: 'Layer Feed', item_type: 'RAW_MATERIAL', uom_primary: 'KG' },
  { nob_code: 'POULTRY', lob_code: 'PLT_LAYING', item_code: 'PLT-TABLE-EGG', item_name: 'Table Eggs', item_type: 'FINISHED_GOODS', uom_primary: 'DOZEN' },
  { nob_code: 'POULTRY', lob_code: 'PLT_HATCHING', item_code: 'PLT-HATCH-EGG', item_name: 'Hatching Egg', item_type: 'RAW_MATERIAL', uom_primary: 'PCS' },
  { nob_code: 'POULTRY', lob_code: 'PLT_HATCHING', item_code: 'PLT-HATCHED-DOC', item_name: 'Hatched Day-Old Chick', item_type: 'FINISHED_GOODS', uom_primary: 'PCS' },
  { nob_code: 'POULTRY', lob_code: 'PLT_CB', item_code: 'PLT-BROILER-FEED', item_name: 'Broiler Grower Feed', item_type: 'RAW_MATERIAL', uom_primary: 'KG' },
  { nob_code: 'POULTRY', lob_code: 'PLT_CB', item_code: 'PLT-LIVE-BROILER', item_name: 'Live Broiler', item_type: 'FINISHED_GOODS', uom_primary: 'KG' },
  { nob_code: 'POULTRY', lob_code: 'PLT_SLAUGHTER', item_code: 'PLT-LIVE-BIRD', item_name: 'Live Bird (Slaughter Input)', item_type: 'RAW_MATERIAL', uom_primary: 'KG' },
  { nob_code: 'POULTRY', lob_code: 'PLT_SLAUGHTER', item_code: 'PLT-DRESSED-CHICKEN', item_name: 'Dressed Chicken', item_type: 'FINISHED_GOODS', uom_primary: 'KG' },
  { nob_code: 'LIVESTOCK', lob_code: 'LVS_MILKING', item_code: 'LVS-DAIRY-FEED', item_name: 'Dairy Cattle Feed', item_type: 'RAW_MATERIAL', uom_primary: 'KG' },
  { nob_code: 'LIVESTOCK', lob_code: 'LVS_MILKING', item_code: 'LVS-RAW-MILK', item_name: 'Raw Milk', item_type: 'FINISHED_GOODS', uom_primary: 'LITER' },
  { nob_code: 'LIVESTOCK', lob_code: 'LVS_PIGGERY', item_code: 'LVS-PIGLET', item_name: 'Piglet', item_type: 'RAW_MATERIAL', uom_primary: 'PCS' },
  { nob_code: 'LIVESTOCK', lob_code: 'LVS_PIGGERY', item_code: 'LVS-PIG-FEED', item_name: 'Pig Feed', item_type: 'RAW_MATERIAL', uom_primary: 'KG' },
  { nob_code: 'LIVESTOCK', lob_code: 'LVS_PIGGERY', item_code: 'LVS-DRESSED-PORK', item_name: 'Dressed Pork', item_type: 'FINISHED_GOODS', uom_primary: 'KG' },
  { nob_code: 'LIVESTOCK', lob_code: 'LVS_GOAT_SHEEP', item_code: 'LVS-GOAT-FEED', item_name: 'Goat Feed', item_type: 'RAW_MATERIAL', uom_primary: 'KG' },
  { nob_code: 'LIVESTOCK', lob_code: 'LVS_GOAT_SHEEP', item_code: 'LVS-LIVE-GOAT', item_name: 'Live Goat', item_type: 'FINISHED_GOODS', uom_primary: 'PCS' },
  { nob_code: 'AGRI', lob_code: 'AGRI_FRUIT', item_code: 'AGR-FRUIT-SAPLING', item_name: 'Fruit Sapling', item_type: 'RAW_MATERIAL', uom_primary: 'PCS' },
  { nob_code: 'AGRI', lob_code: 'AGRI_FRUIT', item_code: 'AGR-FRESH-FRUIT', item_name: 'Fresh Fruit', item_type: 'FINISHED_GOODS', uom_primary: 'KG' },
  { nob_code: 'AGRI', lob_code: 'AGRI_CROP', item_code: 'AGR-SEED-STOCK', item_name: 'Seed Stock', item_type: 'RAW_MATERIAL', uom_primary: 'KG' },
  { nob_code: 'AGRI', lob_code: 'AGRI_CROP', item_code: 'AGR-HARVEST-CROP', item_name: 'Harvested Crop', item_type: 'FINISHED_GOODS', uom_primary: 'TONNE' },
  { nob_code: 'AGRI', lob_code: 'AGRI_SEEDS', item_code: 'AGR-FOUNDATION-SEED', item_name: 'Foundation Seed', item_type: 'RAW_MATERIAL', uom_primary: 'KG' },
  { nob_code: 'AGRI', lob_code: 'AGRI_SEEDS', item_code: 'AGR-CERTIFIED-SEED', item_name: 'Certified Seed', item_type: 'FINISHED_GOODS', uom_primary: 'KG' },
  { nob_code: 'AQUA', lob_code: 'AQA_FISH', item_code: 'AQA-FINGERLING', item_name: 'Fish Fingerling', item_type: 'RAW_MATERIAL', uom_primary: 'PCS' },
  { nob_code: 'AQUA', lob_code: 'AQA_FISH', item_code: 'AQA-FISH-FEED', item_name: 'Fish Feed', item_type: 'RAW_MATERIAL', uom_primary: 'KG' },
  { nob_code: 'AQUA', lob_code: 'AQA_SLAUGHTER', item_code: 'AQA-LIVE-FISH', item_name: 'Live Fish (Slaughter Input)', item_type: 'RAW_MATERIAL', uom_primary: 'KG' },
  { nob_code: 'AQUA', lob_code: 'AQA_SLAUGHTER', item_code: 'AQA-PROCESSED-FISH', item_name: 'Processed Fish', item_type: 'FINISHED_GOODS', uom_primary: 'KG' },
  { nob_code: 'INSECT', lob_code: 'INS_BEE', item_code: 'INS-BEE-COLONY', item_name: 'Bee Colony', item_type: 'RAW_MATERIAL', uom_primary: 'BOX' },
  { nob_code: 'INSECT', lob_code: 'INS_BEE', item_code: 'INS-RAW-HONEY', item_name: 'Raw Honey', item_type: 'FINISHED_GOODS', uom_primary: 'KG' },
  { nob_code: 'INSECT', lob_code: 'BSF', item_code: 'INS-BSF-LARVAE-STOCK', item_name: 'BSF Larvae Stock', item_type: 'RAW_MATERIAL', uom_primary: 'KG' },
  { nob_code: 'INSECT', lob_code: 'BSF', item_code: 'INS-BSF-PROCESSED-FRASS', item_name: 'Processed BSF Frass', item_type: 'FINISHED_GOODS', uom_primary: 'KG' },
  { nob_code: 'PRODUCTION', lob_code: 'FEED_PROD', item_code: 'PRD-RAW-GRAIN', item_name: 'Raw Grain', item_type: 'RAW_MATERIAL', uom_primary: 'TONNE' },
  { nob_code: 'PRODUCTION', lob_code: 'FEED_PROD', item_code: 'PRD-FINISHED-FEED', item_name: 'Finished Feed', item_type: 'FINISHED_GOODS', uom_primary: 'TONNE' },
];

/**
 * Default batch KPI parameters per NOB/LOB — the same CONSUMPTION / MORTALITY
 * / OUTPUT / OVERHEAD types the batch transaction engine itself uses (see
 * TRANSACTION_TYPES in batch.dto.ts), scoped as tenant-wide templates
 * (company_id null) so every LOB's Scheduler/Parameter picker has real
 * options instead of an empty list. CONSUMPTION/OUTPUT parameters carry an
 * item_code resolved to the matching SYSTEM_ITEM_SEED entry above — the
 * parameter DTO treats item_id as required for those two types.
 * Values (feed intake rates, yields) are standard husbandry/agronomy
 * approximations, meant as an editable starting point per company, not a
 * precise breed-specific standard.
 */
export const SYSTEM_PARAMETER_SEED: Array<{
  nob_code: string;
  lob_code: string;
  parameter_code: string;
  parameter_name: string;
  parameter_type: 'CONSUMPTION' | 'MORTALITY' | 'OUTPUT' | 'OVERHEAD' | 'OBSERVATION';
  item_code?: string;
  default_uom?: string;
  qty_method: 'PER_UNIT' | 'PER_BATCH' | 'MANUAL_AT_ENTRY';
  default_qty_per_unit?: number;
  default_qty_per_batch?: number;
  is_mandatory?: boolean;
}> = [
  // Poultry
  { nob_code: 'POULTRY', lob_code: 'PLT_REARING', parameter_code: 'PARAM-PLT-REARING-FEED', parameter_name: 'Starter Feed Consumption', parameter_type: 'CONSUMPTION', item_code: 'PLT-STARTER-FEED', default_uom: 'KG', qty_method: 'PER_UNIT', default_qty_per_unit: 0.05, is_mandatory: true },
  { nob_code: 'POULTRY', lob_code: 'PLT_REARING', parameter_code: 'PARAM-PLT-REARING-MORT', parameter_name: 'Rearing Mortality', parameter_type: 'MORTALITY', default_uom: 'PCS', qty_method: 'MANUAL_AT_ENTRY', is_mandatory: true },
  { nob_code: 'POULTRY', lob_code: 'PLT_LAYING', parameter_code: 'PARAM-PLT-LAYING-FEED', parameter_name: 'Layer Feed Consumption', parameter_type: 'CONSUMPTION', item_code: 'PLT-LAYER-FEED', default_uom: 'KG', qty_method: 'PER_UNIT', default_qty_per_unit: 0.11, is_mandatory: true },
  { nob_code: 'POULTRY', lob_code: 'PLT_LAYING', parameter_code: 'PARAM-PLT-LAYING-MORT', parameter_name: 'Laying Mortality', parameter_type: 'MORTALITY', default_uom: 'PCS', qty_method: 'MANUAL_AT_ENTRY', is_mandatory: true },
  { nob_code: 'POULTRY', lob_code: 'PLT_LAYING', parameter_code: 'PARAM-PLT-LAYING-EGG', parameter_name: 'Egg Production (Hen-Day Rate)', parameter_type: 'OUTPUT', item_code: 'PLT-TABLE-EGG', default_uom: 'DOZEN', qty_method: 'PER_UNIT', default_qty_per_unit: 0.075, is_mandatory: true },
  { nob_code: 'POULTRY', lob_code: 'PLT_HATCHING', parameter_code: 'PARAM-PLT-HATCH-OUTPUT', parameter_name: 'Hatch Output', parameter_type: 'OUTPUT', item_code: 'PLT-HATCHED-DOC', default_uom: 'PCS', qty_method: 'PER_BATCH', is_mandatory: true },
  { nob_code: 'POULTRY', lob_code: 'PLT_CB', parameter_code: 'PARAM-PLT-CB-FEED', parameter_name: 'Broiler Feed Consumption', parameter_type: 'CONSUMPTION', item_code: 'PLT-BROILER-FEED', default_uom: 'KG', qty_method: 'PER_UNIT', default_qty_per_unit: 0.09, is_mandatory: true },
  { nob_code: 'POULTRY', lob_code: 'PLT_CB', parameter_code: 'PARAM-PLT-CB-MORT', parameter_name: 'Broiler Mortality', parameter_type: 'MORTALITY', default_uom: 'PCS', qty_method: 'MANUAL_AT_ENTRY', is_mandatory: true },
  { nob_code: 'POULTRY', lob_code: 'PLT_CB', parameter_code: 'PARAM-PLT-CB-WEIGHT', parameter_name: 'Live Weight Output', parameter_type: 'OUTPUT', item_code: 'PLT-LIVE-BROILER', default_uom: 'KG', qty_method: 'PER_UNIT', default_qty_per_unit: 2.0, is_mandatory: true },
  { nob_code: 'POULTRY', lob_code: 'PLT_SLAUGHTER', parameter_code: 'PARAM-PLT-SLAUGHTER-OUTPUT', parameter_name: 'Dressed Output', parameter_type: 'OUTPUT', item_code: 'PLT-DRESSED-CHICKEN', default_uom: 'KG', qty_method: 'PER_BATCH', is_mandatory: true },
  // Livestock
  { nob_code: 'LIVESTOCK', lob_code: 'LVS_MILKING', parameter_code: 'PARAM-LVS-MILKING-FEED', parameter_name: 'Dairy Feed Consumption', parameter_type: 'CONSUMPTION', item_code: 'LVS-DAIRY-FEED', default_uom: 'KG', qty_method: 'PER_UNIT', default_qty_per_unit: 12, is_mandatory: true },
  { nob_code: 'LIVESTOCK', lob_code: 'LVS_MILKING', parameter_code: 'PARAM-LVS-MILKING-MORT', parameter_name: 'Herd Mortality', parameter_type: 'MORTALITY', default_uom: 'PCS', qty_method: 'MANUAL_AT_ENTRY', is_mandatory: true },
  { nob_code: 'LIVESTOCK', lob_code: 'LVS_MILKING', parameter_code: 'PARAM-LVS-MILKING-YIELD', parameter_name: 'Milk Yield', parameter_type: 'OUTPUT', item_code: 'LVS-RAW-MILK', default_uom: 'LITER', qty_method: 'PER_UNIT', default_qty_per_unit: 15, is_mandatory: true },
  { nob_code: 'LIVESTOCK', lob_code: 'LVS_PIGGERY', parameter_code: 'PARAM-LVS-PIGGERY-FEED', parameter_name: 'Pig Feed Consumption', parameter_type: 'CONSUMPTION', item_code: 'LVS-PIG-FEED', default_uom: 'KG', qty_method: 'PER_UNIT', default_qty_per_unit: 2.2, is_mandatory: true },
  { nob_code: 'LIVESTOCK', lob_code: 'LVS_PIGGERY', parameter_code: 'PARAM-LVS-PIGGERY-MORT', parameter_name: 'Herd Mortality', parameter_type: 'MORTALITY', default_uom: 'PCS', qty_method: 'MANUAL_AT_ENTRY', is_mandatory: true },
  { nob_code: 'LIVESTOCK', lob_code: 'LVS_PIGGERY', parameter_code: 'PARAM-LVS-PIGGERY-WEIGHT', parameter_name: 'Dressed Weight Output', parameter_type: 'OUTPUT', item_code: 'LVS-DRESSED-PORK', default_uom: 'KG', qty_method: 'PER_UNIT', default_qty_per_unit: 65, is_mandatory: true },
  { nob_code: 'LIVESTOCK', lob_code: 'LVS_GOAT_SHEEP', parameter_code: 'PARAM-LVS-GOAT-FEED', parameter_name: 'Goat Feed Consumption', parameter_type: 'CONSUMPTION', item_code: 'LVS-GOAT-FEED', default_uom: 'KG', qty_method: 'PER_UNIT', default_qty_per_unit: 1.5, is_mandatory: true },
  { nob_code: 'LIVESTOCK', lob_code: 'LVS_GOAT_SHEEP', parameter_code: 'PARAM-LVS-GOAT-MORT', parameter_name: 'Herd Mortality', parameter_type: 'MORTALITY', default_uom: 'PCS', qty_method: 'MANUAL_AT_ENTRY', is_mandatory: true },
  // Agriculture (no herd mortality — output/yield-driven instead)
  { nob_code: 'AGRI', lob_code: 'AGRI_FRUIT', parameter_code: 'PARAM-AGR-FRUIT-YIELD', parameter_name: 'Fruit Yield', parameter_type: 'OUTPUT', item_code: 'AGR-FRESH-FRUIT', default_uom: 'KG', qty_method: 'PER_BATCH', is_mandatory: true },
  { nob_code: 'AGRI', lob_code: 'AGRI_CROP', parameter_code: 'PARAM-AGR-CROP-YIELD', parameter_name: 'Crop Yield', parameter_type: 'OUTPUT', item_code: 'AGR-HARVEST-CROP', default_uom: 'TONNE', qty_method: 'PER_BATCH', is_mandatory: true },
  { nob_code: 'AGRI', lob_code: 'AGRI_SEEDS', parameter_code: 'PARAM-AGR-SEEDS-OUTPUT', parameter_name: 'Seed Multiplication Output', parameter_type: 'OUTPUT', item_code: 'AGR-CERTIFIED-SEED', default_uom: 'KG', qty_method: 'PER_BATCH', is_mandatory: true },
  // Aquaculture
  { nob_code: 'AQUA', lob_code: 'AQA_FISH', parameter_code: 'PARAM-AQA-FISH-FEED', parameter_name: 'Fish Feed Consumption', parameter_type: 'CONSUMPTION', item_code: 'AQA-FISH-FEED', default_uom: 'KG', qty_method: 'PER_BATCH', is_mandatory: true },
  { nob_code: 'AQUA', lob_code: 'AQA_FISH', parameter_code: 'PARAM-AQA-FISH-MORT', parameter_name: 'Pond Mortality', parameter_type: 'MORTALITY', default_uom: 'PCS', qty_method: 'MANUAL_AT_ENTRY', is_mandatory: true },
  { nob_code: 'AQUA', lob_code: 'AQA_SLAUGHTER', parameter_code: 'PARAM-AQA-SLAUGHTER-OUTPUT', parameter_name: 'Processed Fish Output', parameter_type: 'OUTPUT', item_code: 'AQA-PROCESSED-FISH', default_uom: 'KG', qty_method: 'PER_BATCH', is_mandatory: true },
  // Insect farming
  { nob_code: 'INSECT', lob_code: 'INS_BEE', parameter_code: 'PARAM-INS-BEE-YIELD', parameter_name: 'Honey Yield', parameter_type: 'OUTPUT', item_code: 'INS-RAW-HONEY', default_uom: 'KG', qty_method: 'PER_UNIT', default_qty_per_unit: 20, is_mandatory: true },
  { nob_code: 'INSECT', lob_code: 'BSF', parameter_code: 'PARAM-INS-BSF-OUTPUT', parameter_name: 'Frass Output', parameter_type: 'OUTPUT', item_code: 'INS-BSF-PROCESSED-FRASS', default_uom: 'KG', qty_method: 'PER_BATCH', is_mandatory: true },
  // Feed production
  { nob_code: 'PRODUCTION', lob_code: 'FEED_PROD', parameter_code: 'PARAM-PRD-FEED-GRAIN', parameter_name: 'Raw Grain Usage', parameter_type: 'CONSUMPTION', item_code: 'PRD-RAW-GRAIN', default_uom: 'TONNE', qty_method: 'PER_BATCH', is_mandatory: true },
  { nob_code: 'PRODUCTION', lob_code: 'FEED_PROD', parameter_code: 'PARAM-PRD-FEED-OUTPUT', parameter_name: 'Finished Feed Output', parameter_type: 'OUTPUT', item_code: 'PRD-FINISHED-FEED', default_uom: 'TONNE', qty_method: 'PER_BATCH', is_mandatory: true },
];

/**
 * The 11 piggery production stages, transcribed from the Stage Master Template's
 * "Example" sheet (NAVFarm_Master_Tables spec, Sheet 17_STAGE_MASTER). Piggery-only
 * — unlike breed/item/parameter above, Stage Master's transition rules aren't
 * documented for any other LOB, so seeding placeholder sequences for
 * POULTRY/AQUA/AGRI/INSECT here would be inventing undocumented business rules.
 * The table is still fully usable for other LOBs via the normal Stage CRUD API
 * once their sequences are documented.
 *
 * next_stage_code/alt_next_stage_code are resolved to real stage_master ids at
 * seed time (see tenant.service.ts) via a stage_code -> pre-generated UUID map,
 * the same technique already used there for itemIdByCode.
 *
 * One gap in the source spec, left as-is rather than silently invented: WEANING's
 * alt_next_stage in the source Example sheet is "CULLED", a stage code that does
 * not exist among these 11 rows. alt_next_stage_code is left undefined for that
 * row — it resolves to a null alt_next_stage_id rather than a made-up stage.
 */
const LEGACY_STAGE_SEED: Array<{
  stage_code: string;
  stage_name: string;
  stage_category: 'PRE_PRODUCTIVE' | 'PRODUCTIVE' | 'OUTPUT' | 'DISPOSAL';
  stage_sequence: number;
  typical_duration_days?: number;
  min_days_before_move: number;
  transition_trigger: 'AUTO_BY_DAY' | 'MANUAL' | 'EVENT_BASED' | 'KPI_BASED';
  auto_move_on_day?: number;
  next_stage_code?: string;
  alt_next_stage_code?: string;
  alt_trigger_condition?: string;
  data_entry_form: 'STANDARD' | 'FARROWING' | 'WEANING' | 'SLAUGHTER';
  show_on_animal_card: boolean;
  stage_description: string;
}> = [
  { stage_code: 'QUARANTINE', stage_name: 'Quarantine', stage_category: 'PRE_PRODUCTIVE', stage_sequence: 1, typical_duration_days: 30, min_days_before_move: 14, transition_trigger: 'AUTO_BY_DAY', auto_move_on_day: 30, next_stage_code: 'GILT_GROWER', data_entry_form: 'STANDARD', show_on_animal_card: true, stage_description: 'Animals kept isolated for health monitoring before entering main production.' },
  { stage_code: 'GILT_GROWER', stage_name: 'Gilt Grower Phase', stage_category: 'PRE_PRODUCTIVE', stage_sequence: 2, typical_duration_days: 77, min_days_before_move: 56, transition_trigger: 'MANUAL', next_stage_code: 'FLUSH_SERVICE', data_entry_form: 'STANDARD', show_on_animal_card: true, stage_description: 'Growing phase for gilts before they enter breeding.' },
  { stage_code: 'FLUSH_SERVICE', stage_name: 'Flush and Service / AI', stage_category: 'PRE_PRODUCTIVE', stage_sequence: 3, typical_duration_days: 10, min_days_before_move: 5, transition_trigger: 'EVENT_BASED', next_stage_code: 'DRY_SOW_GESTATION', alt_next_stage_code: 'GILT_GROWER', alt_trigger_condition: 'CONCEPTION_FAILED', data_entry_form: 'STANDARD', show_on_animal_card: true, stage_description: 'Flushing feed regime and mating/AI event for the sow or gilt.' },
  { stage_code: 'DRY_SOW_GESTATION', stage_name: 'Dry Sow / Gestation', stage_category: 'PRODUCTIVE', stage_sequence: 4, typical_duration_days: 110, min_days_before_move: 90, transition_trigger: 'EVENT_BASED', next_stage_code: 'FARROWING', alt_next_stage_code: 'FLUSH_SERVICE', alt_trigger_condition: 'PREGNANCY_FAILED', data_entry_form: 'STANDARD', show_on_animal_card: true, stage_description: 'Confirmed pregnancy through to term.' },
  { stage_code: 'FARROWING', stage_name: 'Farrowing', stage_category: 'OUTPUT', stage_sequence: 5, typical_duration_days: 3, min_days_before_move: 1, transition_trigger: 'EVENT_BASED', next_stage_code: 'LACTATION', data_entry_form: 'FARROWING', show_on_animal_card: true, stage_description: 'Birth of the litter.' },
  { stage_code: 'LACTATION', stage_name: 'Lactation / Nursing', stage_category: 'PRODUCTIVE', stage_sequence: 6, typical_duration_days: 28, min_days_before_move: 21, transition_trigger: 'AUTO_BY_DAY', auto_move_on_day: 28, next_stage_code: 'WEANING', data_entry_form: 'STANDARD', show_on_animal_card: true, stage_description: 'Nursing period following farrowing.' },
  { stage_code: 'WEANING', stage_name: 'Weaning', stage_category: 'OUTPUT', stage_sequence: 7, typical_duration_days: 1, min_days_before_move: 1, transition_trigger: 'EVENT_BASED', next_stage_code: 'FLUSH_SERVICE', alt_trigger_condition: 'PARITY_LIMIT_REACHED', data_entry_form: 'WEANING', show_on_animal_card: true, stage_description: 'Piglets separated from the sow; sow returns to the breeding cycle.' },
  { stage_code: 'BOAR_AI', stage_name: 'Boar AI Station', stage_category: 'PRODUCTIVE', stage_sequence: 8, min_days_before_move: 30, transition_trigger: 'MANUAL', next_stage_code: 'BOAR_AI', alt_next_stage_code: 'DISPOSED', alt_trigger_condition: 'END_OF_PRODUCTIVE_LIFE', data_entry_form: 'STANDARD', show_on_animal_card: true, stage_description: 'Ongoing semen collection station for an active boar.' },
  { stage_code: 'CB_GROWER', stage_name: 'CB Grower Phase', stage_category: 'PRE_PRODUCTIVE', stage_sequence: 9, typical_duration_days: 77, min_days_before_move: 60, transition_trigger: 'KPI_BASED', next_stage_code: 'SLAUGHTER', data_entry_form: 'STANDARD', show_on_animal_card: false, stage_description: 'Commercial batch grow-out phase for weaned piglets bound for market.' },
  { stage_code: 'SLAUGHTER', stage_name: 'Slaughter', stage_category: 'DISPOSAL', stage_sequence: 10, typical_duration_days: 1, min_days_before_move: 1, transition_trigger: 'EVENT_BASED', next_stage_code: 'DISPOSED', data_entry_form: 'SLAUGHTER', show_on_animal_card: false, stage_description: 'Slaughter event, subject to medicine/vaccine withdrawal-period checks.' },
  { stage_code: 'DISPOSED', stage_name: 'Disposed / End of Life', stage_category: 'DISPOSAL', stage_sequence: 11, min_days_before_move: 0, transition_trigger: 'MANUAL', data_entry_form: 'STANDARD', show_on_animal_card: true, stage_description: 'Terminal stage — animal sold, slaughtered, or deceased.' },
];

/** BBP §1.7 supersedes the earlier 11-stage workbook examples above. */
export const SYSTEM_STAGE_SEED: typeof LEGACY_STAGE_SEED = [...BBP_STAGE_SEED];

/**
 * Number Series definitions. BATCH is tenant-wide (nob_code/lob_code unset) —
 * the series that already had an equivalent hand-rolled generator before Phase
 * 3; batch.service.ts's generateBatchNo() now delegates to
 * NumberSeriesService.generateNext('BATCH', ...) instead of counting
 * batch_header rows directly. Format matches what generateBatchNo() already
 * produced (BATCH-000001, no date segment) so no existing batch_no changes
 * shape. ANIMAL_PIGGERY is scoped to LIVESTOCK/LVS_PIGGERY (Phase 5) and
 * matches the spec's PIG-YYYY-SEQ format exactly, exercising both the
 * date-segment and YEARLY-reset paths BATCH doesn't.
 */
export const SYSTEM_NO_SERIES_SEED: Array<{
  series_code: string;
  series_name: string;
  document_type: string;
  nob_code?: string;
  lob_code?: string;
  prefix?: string;
  separator: string;
  seq_separator?: string;
  seq_length: number;
  reset_frequency: 'YEARLY' | 'MONTHLY' | 'NEVER';
  allow_manual?: boolean;
  code_segments?: string[];
  prefix_position?: 'START' | 'END';
  /**
   * Defaults to true. False is how a master says "this code is typed, never
   * generated": resolveSeriesFor() and resolveCodeSettings() both filter on
   * is_active, so an inactive row resolves to null and the master falls to its
   * own createManual() path — while the row still exists, so the master counts
   * as having a series and the screen shows the definition rather than an empty
   * slot inviting someone to invent one.
   */
  is_active?: boolean;
}> = [
  // One series per master, named after the master it serves. There used to be a
  // row per VARIANT — LOCATION_FARM, LOCATION_SHED, LOCATION_PEN and so on, one
  // more with every location type anyone added — because a series held exactly
  // one prefix, so anything that varied needed its own row. A series takes the
  // varying part as a segment now, and one row covers every variant.
  //
  // Three shapes:
  //   named   the code IS the name. Sequence Digits 0, no prefix, one name
  //           segment: a breed is LARGE_WHITE, and LARGE_WHITE-001 would count
  //           something already unique. A repeat is rejected, not numbered.
  //   built   composed from the record's own fields plus a prefix.
  //   serial  prefix and number, because the name is prose. "Demo Grain and
  //           Feed Suppliers" is better as SUP-004 than DEMO_GRAIN_AND_FEED.

  // named
  { series_code: 'BREED', series_name: 'Breed Code', document_type: 'BREED', separator: '-', seq_length: 0, reset_frequency: 'NEVER', allow_manual: true, code_segments: ['breed_name'] },
  { series_code: 'ITEM_TYPE', series_name: 'Item Type Code', document_type: 'ITEM_TYPE', separator: '-', seq_length: 0, reset_frequency: 'NEVER', allow_manual: true, code_segments: ['type_name'] },
  { series_code: 'ITEM_ATTRIBUTE', series_name: 'Item Attribute Code', document_type: 'ITEM_ATTRIBUTE', separator: '-', seq_length: 0, reset_frequency: 'NEVER', allow_manual: true, code_segments: ['attribute_name'] },
  { series_code: 'LOCATION_TYPE', series_name: 'Location Type Code', document_type: 'LOCATION_TYPE', separator: '-', seq_length: 0, reset_frequency: 'NEVER', allow_manual: true, code_segments: ['type_name'] },
  // The name, not UOM-001 — a unit called UOM-003 tells nobody what it measures.
  // Most units then get typed over: of the ten in use, Dose, Gram and Hour come
  // straight from their name while KG, ML, LITER, HR and the rest are the
  // standard symbol, which no rule derives from "Kilogram" or "Millilitre".
  // allow_manual is what makes that the normal case rather than a workaround.
  { series_code: 'UOM', series_name: 'Unit of Measure Code', document_type: 'UOM', separator: '-', seq_length: 0, reset_frequency: 'NEVER', allow_manual: true, code_segments: ['uom_name'] },
  // A sub-category is not a master of its own — it is an item category with a
  // parent, so one series covers both, and its code is its own name alone.
  //
  // It briefly carried its parent too (FEED-LACTATION, matching the hand-made
  // codes already in the data), but the item code names the category and the
  // sub-category as separate parts — <category>-<sub-category> — so a
  // sub-category repeating its parent put FEED in an item code three times.
  // The parent belongs there once, via the category segment.
  //
  // The cost: two sub-categories with the same name under different parents
  // collide, and the second is refused rather than numbered. That is the same
  // rule every name-based master follows.
  { series_code: 'ITEM_CATEGORY', series_name: 'Item Category Code', document_type: 'ITEM_CATEGORY', separator: '-', seq_length: 0, reset_frequency: 'NEVER', allow_manual: true, code_segments: ['category_name'] },
  // STAGE and SPECIES were serials — STG-001, SPC-001 — and nothing has ever
  // carried such a code. Every stage in the tenant is GESTATION, FARROWING,
  // QUARANTINE: the name, which is also what twelve files match on as a string
  // literal, location.service and animal.service among them. A serial series
  // described none of that and could only ever have been overridden by hand.
  //
  // Named on the stage's own name, the series produces exactly the fifteen
  // codes already in the database, so the definition now describes the data
  // instead of contradicting it — and STG-004 can no longer be generated for
  // something the rest of the codebase expects to find as GESTATION.
  { series_code: 'STAGE', series_name: 'Stage Code', document_type: 'STAGE', separator: '-', seq_length: 0, reset_frequency: 'NEVER', allow_manual: true, code_segments: ['stage_name'] },
  // Same for species: eleven of the twelve seeded codes are already the name.
  // The twelfth was BEE against the name "Honey Bee", corrected in
  // SYSTEM_SPECIES_SEED rather than special-cased here.
  { series_code: 'SPECIES', series_name: 'Species Code', document_type: 'SPECIES', separator: '-', seq_length: 0, reset_frequency: 'NEVER', allow_manual: true, code_segments: ['species_name'] },

  // built
  { series_code: 'ITEM', series_name: 'Item Code', document_type: 'ITEM', prefix: 'ITM', separator: '-', seq_length: 4, reset_frequency: 'NEVER', allow_manual: true, code_segments: ['item_type', 'category_id', 'sub_category'] },
  // The year comes off the animal's own dob, not off the clock: an animal
  // entered late used to be stamped with the year of typing.
  { series_code: 'ANIMAL', series_name: 'Animal Code', document_type: 'ANIMAL', nob_code: 'LIVESTOCK', lob_code: 'LVS_PIGGERY', prefix: 'PIG', separator: '-', seq_length: 4, reset_frequency: 'NEVER', allow_manual: true, code_segments: ['dob:YEAR'], prefix_position: 'START' },
  // "/" between the levels of the path and "-" before the number, so the code
  // reads as a path ending in a count — FARM-001/SHED-001/PEN-001 — and a
  // first-level location, having no parent to name, is simply FARM-001.
  { series_code: 'LOCATION', series_name: 'Location Code', document_type: 'LOCATION', separator: '/', seq_separator: '-', seq_length: 3, reset_frequency: 'NEVER', allow_manual: true, code_segments: ['parent_location_id', 'location_type'] },
  // TDD row 75: "Lifecycle ID, should be auto-fetched using a (breed data)".
  // Breed and stage together say what the row is for — LARGE_WHITE-GESTATION —
  // and the number distinguishes the period ranges within that pair, of which a
  // breed and stage can have several.
  { series_code: 'BREED_LIFECYCLE_STAGE', series_name: 'Breed Lifecycle Stage Code', document_type: 'BREED_LIFECYCLE_STAGE', separator: '-', seq_length: 3, reset_frequency: 'NEVER', allow_manual: true, code_segments: ['breed_id', 'stage_id'] },

  // serial
  { series_code: 'BATCH', series_name: 'Batch Number', document_type: 'BATCH', prefix: 'BATCH', separator: '-', seq_length: 6, reset_frequency: 'NEVER' },
  { series_code: 'REASON', series_name: 'Reason Code', document_type: 'REASON', prefix: 'RSN', separator: '-', seq_length: 3, reset_frequency: 'NEVER', allow_manual: true },
  { series_code: 'SUPPLIER', series_name: 'Supplier Code', document_type: 'SUPPLIER', prefix: 'SUP', separator: '-', seq_length: 3, reset_frequency: 'NEVER', allow_manual: true },
  { series_code: 'CUSTOMER', series_name: 'Customer Code', document_type: 'CUSTOMER', prefix: 'CUS', separator: '-', seq_length: 3, reset_frequency: 'NEVER', allow_manual: true },
  { series_code: 'RESOURCE', series_name: 'Resource Code', document_type: 'RESOURCE', prefix: 'RES', separator: '-', seq_length: 3, reset_frequency: 'NEVER', allow_manual: true },
  { series_code: 'UOM_CONVERSION', series_name: 'UOM Conversion Code', document_type: 'UOM_CONVERSION', prefix: 'CONV', separator: '-', seq_length: 3, reset_frequency: 'NEVER', allow_manual: true },
  { series_code: 'DISEASE', series_name: 'Disease Code', document_type: 'DISEASE', prefix: 'DIS', separator: '-', seq_length: 3, reset_frequency: 'NEVER', allow_manual: true },
  { series_code: 'FEED_FORMULA', series_name: 'Feed Formula Code', document_type: 'FEED_FORMULA', prefix: 'FORM', separator: '-', seq_length: 3, reset_frequency: 'NEVER', allow_manual: true },

  // Both inactive: defined, so the master is not shown as missing a series, but
  // never generating, so the code stays whatever accounting says it is.
  //
  // A GL account's number IS the chart of accounts — 1000s assets, 4000s
  // revenue, 5000s expenses — and the twenty seeded accounts follow it (1010,
  // 4020, 5050). GL-001 would throw that away, and BBP-1 §1.6 puts the catalog
  // in D365BC anyway, so nothing here should be minting account numbers.
  // Cost centres follow for the same reason: CC-FEEDMILL-A says which mill,
  // CC-001 says nothing, and the pairing to a GL account is done by hand.
  { series_code: 'COST_CENTER', series_name: 'Cost Center Code (typed, not generated)', document_type: 'COST_CENTER', prefix: 'CC', separator: '-', seq_length: 3, reset_frequency: 'NEVER', allow_manual: true, is_active: false },
  { series_code: 'GL_ACCOUNT', series_name: 'GL Account Code (typed; BC-owned catalog)', document_type: 'GL_ACCOUNT', prefix: 'GL', separator: '-', seq_length: 3, reset_frequency: 'NEVER', allow_manual: true, is_active: false },
  { series_code: 'GL_MAPPING', series_name: 'GL Mapping Code', document_type: 'GL_MAPPING', prefix: 'GLMAP', separator: '-', seq_length: 3, reset_frequency: 'NEVER', allow_manual: true },
  // No LOT or SERIAL series. One item has many lots, so a lot number is not a
  // property of the item — it belongs to the receipt that delivered it, and
  // goods_receipt_line.lot_no is where it is captured. Nothing ever generated
  // from these two; they existed only to give the Item form's Tracking No.
  // Series picker something to offer.
];

/**
 * Breed Lifecycle Stages — per-stage production standards for piggery breeds.
 *
 * Transcribed from the spec's "Breed Lifecycle Stages" sheet (Breed Master
 * Template workbook). Each row binds a breed_code + stage_code pair to:
 *   feed_qty_per_head_per_day_kg — standard daily feed intake
 *   std_adg_gpd                  — Average Daily Gain target (grams/day)
 *   std_fcr                      — Feed Conversion Ratio target
 *   std_body_weight_kg           — expected body weight at end of stage
 *   std_mortality_rate_pct       — acceptable mortality % for this stage
 *   kpi_lower_limit / kpi_upper_limit / alert_severity — alert thresholds
 *
 * Yorkshire and Large White share identical numeric values (same genetic line).
 * Landrace and Duroc diverge on ADG/FCR/litter size per breed characteristics.
 *
 * breed_code and stage_code are resolved to UUIDs at seed time in seed-dev-tenant.ts.
 * feed_item_code and output_item_code are resolved to item_ids from SYSTEM_ITEM_SEED.
 */
const LEGACY_BREED_LIFECYCLE_SEED: Array<{
  breed_code: string;
  stage_code: string;
  calc_unit: 'DAY' | 'WEEK' | 'MONTH';
  period_from: number;
  period_to: number;
  feed_item_code?: string;
  feed_qty_per_head_per_day_kg?: number;
  feed_wastage_pct?: number;
  std_body_weight_kg?: number;
  std_adg_gpd?: number;
  std_fcr?: number;
  std_mortality_rate_pct?: number;
  output_item_code?: string;
  output_uom?: string;
  std_output_qty?: number;
  kpi_lower_limit?: number;
  kpi_upper_limit?: number;
  alert_severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  notes?: string;
}> = [
  // -- YORKSHIRE / LARGE_WHITE (identical standards -- same genetic line) -----------
  ...(['YORKSHIRE', 'LARGE_WHITE'] as const).flatMap((breed_code) => [
    { breed_code, stage_code: 'QUARANTINE',        calc_unit: 'DAY' as const, period_from: 1, period_to: 30,  feed_item_code: 'LVS-PIG-FEED', feed_qty_per_head_per_day_kg: 1.5, feed_wastage_pct: 5.00, std_body_weight_kg: 45.0,  std_adg_gpd: 350, std_fcr: 4.30, std_mortality_rate_pct: 1.0, kpi_lower_limit: 300, kpi_upper_limit: 500, alert_severity: 'WARNING'  as const, notes: 'Isolation period. Monitor respiratory and enteric disease. Vaccinate per schedule. Target BCS 3.0 at exit.' },
    { breed_code, stage_code: 'GILT_GROWER',       calc_unit: 'DAY' as const, period_from: 1, period_to: 77,  feed_item_code: 'LVS-PIG-FEED', feed_qty_per_head_per_day_kg: 2.2, feed_wastage_pct: 5.00, std_body_weight_kg: 125.0, std_adg_gpd: 800, std_fcr: 2.75, std_mortality_rate_pct: 0.5, kpi_lower_limit: 700, kpi_upper_limit: 950, alert_severity: 'WARNING'  as const, notes: 'Grow gilt to service weight 120-135 kg. ADG target 800 g/day. Flush feeding starts Day 70.' },
    { breed_code, stage_code: 'FLUSH_SERVICE',     calc_unit: 'DAY' as const, period_from: 1, period_to: 10,  feed_item_code: 'LVS-PIG-FEED', feed_qty_per_head_per_day_kg: 3.0, feed_wastage_pct: 5.00, std_body_weight_kg: 128.0, std_mortality_rate_pct: 0.2, alert_severity: 'INFO'    as const, notes: 'Increase feed 2-3 kg/day to stimulate ovulation. Record AI/mating date. Confirm conception at Day 21 scan.' },
    { breed_code, stage_code: 'DRY_SOW_GESTATION', calc_unit: 'DAY' as const, period_from: 1, period_to: 110, feed_item_code: 'LVS-PIG-FEED', feed_qty_per_head_per_day_kg: 2.5, feed_wastage_pct: 3.00, std_body_weight_kg: 165.0, std_adg_gpd: 300, std_mortality_rate_pct: 0.3, kpi_lower_limit: 200, kpi_upper_limit: 450, alert_severity: 'WARNING'  as const, notes: 'Maintain BCS 3.0-3.5. Increase to 3.0 kg/day from Day 90. Move to farrowing crate Day 110.' },
    { breed_code, stage_code: 'FARROWING',         calc_unit: 'DAY' as const, period_from: 1, period_to: 3,   feed_item_code: 'LVS-PIG-FEED', feed_qty_per_head_per_day_kg: 1.5, feed_wastage_pct: 0, output_item_code: 'LVS-PIGLET', output_uom: 'PCS', std_output_qty: 11.5, std_mortality_rate_pct: 0.5, kpi_lower_limit: 9.0, kpi_upper_limit: 14.0, alert_severity: 'CRITICAL' as const, notes: 'Record litter born alive and stillbirths. KPI: live born >= 11. Ramp to lactation ration Day 3.' },
    { breed_code, stage_code: 'LACTATION',         calc_unit: 'DAY' as const, period_from: 1, period_to: 28,  feed_item_code: 'LVS-PIG-FEED', feed_qty_per_head_per_day_kg: 6.5, feed_wastage_pct: 3.00, std_body_weight_kg: 155.0, std_mortality_rate_pct: 0.3, output_item_code: 'LVS-PIGLET', output_uom: 'PCS', std_output_qty: 10.0, kpi_lower_limit: 9.0, kpi_upper_limit: 12.0, alert_severity: 'WARNING'  as const, notes: 'Ad-lib sow feed to maximise milk yield. Wean at 28 days (min 21). Target weaning weight 7 kg/piglet.' },
    { breed_code, stage_code: 'WEANING',           calc_unit: 'DAY' as const, period_from: 1, period_to: 1, output_item_code: 'LVS-PIGLET', output_uom: 'PCS', std_output_qty: 10.0, std_mortality_rate_pct: 0.0, alert_severity: 'INFO'    as const, notes: 'Record weaning weight. Sow weaning-to-service interval target <= 5 days.' },
    { breed_code, stage_code: 'BOAR_AI',           calc_unit: 'WEEK' as const, period_from: 1, period_to: 104, feed_item_code: 'LVS-PIG-FEED', feed_qty_per_head_per_day_kg: 2.8, feed_wastage_pct: 3.00, std_body_weight_kg: 200.0, std_mortality_rate_pct: 0.0, kpi_lower_limit: 3.0, kpi_upper_limit: 6.0, alert_severity: 'WARNING'  as const, notes: 'Collect 4 doses/week. Evaluate semen motility each collection. Record libido score.' },
    { breed_code, stage_code: 'CB_GROWER',         calc_unit: 'DAY' as const, period_from: 1, period_to: 77,  feed_item_code: 'LVS-PIG-FEED', feed_qty_per_head_per_day_kg: 2.5, feed_wastage_pct: 5.00, std_body_weight_kg: 115.0, std_adg_gpd: 800, std_fcr: 2.80, std_mortality_rate_pct: 1.5, output_item_code: 'LVS-DRESSED-PORK', output_uom: 'KG', std_output_qty: 82.0, kpi_lower_limit: 700, kpi_upper_limit: 950, alert_severity: 'CRITICAL' as const, notes: 'Target market weight 115 kg at 77 days. FCR must stay <= 2.8. Withdrawal periods mandatory.' },
    { breed_code, stage_code: 'SLAUGHTER',         calc_unit: 'DAY' as const, period_from: 1, period_to: 1, output_item_code: 'LVS-DRESSED-PORK', output_uom: 'KG', std_output_qty: 82.0, std_mortality_rate_pct: 0.0, alert_severity: 'INFO'    as const, notes: 'Check withdrawal periods. Record live weight, dressed weight, dressing pct, condemnations.' },
    { breed_code, stage_code: 'DISPOSED',          calc_unit: 'DAY' as const, period_from: 1, period_to: 1, std_mortality_rate_pct: 0.0, alert_severity: 'INFO'    as const, notes: 'Record disposal reason: sold, slaughtered, died, culled.' },
  ]),

  // -- LANDRACE (prolific maternal line -- higher litter, slightly lower ADG) --------
  ...(['LANDRACE'] as const).flatMap((breed_code) => [
    { breed_code, stage_code: 'QUARANTINE',        calc_unit: 'DAY' as const, period_from: 1, period_to: 30,  feed_item_code: 'LVS-PIG-FEED', feed_qty_per_head_per_day_kg: 1.5, feed_wastage_pct: 5.00, std_body_weight_kg: 43.0,  std_adg_gpd: 340, std_fcr: 4.40, std_mortality_rate_pct: 1.0, kpi_lower_limit: 280, kpi_upper_limit: 500, alert_severity: 'WARNING'  as const, notes: 'Same quarantine protocol as Yorkshire.' },
    { breed_code, stage_code: 'GILT_GROWER',       calc_unit: 'DAY' as const, period_from: 1, period_to: 77,  feed_item_code: 'LVS-PIG-FEED', feed_qty_per_head_per_day_kg: 2.2, feed_wastage_pct: 5.00, std_body_weight_kg: 122.0, std_adg_gpd: 780, std_fcr: 2.80, std_mortality_rate_pct: 0.5, kpi_lower_limit: 680, kpi_upper_limit: 950, alert_severity: 'WARNING'  as const, notes: 'Landrace gilts service weight 120-130 kg.' },
    { breed_code, stage_code: 'FLUSH_SERVICE',     calc_unit: 'DAY' as const, period_from: 1, period_to: 10,  feed_item_code: 'LVS-PIG-FEED', feed_qty_per_head_per_day_kg: 3.0, feed_wastage_pct: 5.00, std_body_weight_kg: 125.0, std_mortality_rate_pct: 0.2, alert_severity: 'INFO'    as const, notes: 'High farrowing rate 87%. Confirm conception scan Day 21.' },
    { breed_code, stage_code: 'DRY_SOW_GESTATION', calc_unit: 'DAY' as const, period_from: 1, period_to: 115, feed_item_code: 'LVS-PIG-FEED', feed_qty_per_head_per_day_kg: 2.5, feed_wastage_pct: 3.00, std_body_weight_kg: 168.0, std_adg_gpd: 295, std_mortality_rate_pct: 0.3, kpi_lower_limit: 200, kpi_upper_limit: 440, alert_severity: 'WARNING'  as const, notes: 'Landrace gestation 115 days. Maintain BCS 3.0-3.5.' },
    { breed_code, stage_code: 'FARROWING',         calc_unit: 'DAY' as const, period_from: 1, period_to: 3,   feed_item_code: 'LVS-PIG-FEED', feed_qty_per_head_per_day_kg: 1.5, feed_wastage_pct: 0, output_item_code: 'LVS-PIGLET', output_uom: 'PCS', std_output_qty: 12.0, std_mortality_rate_pct: 0.5, kpi_lower_limit: 10.0, kpi_upper_limit: 15.0, alert_severity: 'CRITICAL' as const, notes: 'Largest litter of 4 breeds. Target live born >= 12.' },
    { breed_code, stage_code: 'LACTATION',         calc_unit: 'DAY' as const, period_from: 1, period_to: 28,  feed_item_code: 'LVS-PIG-FEED', feed_qty_per_head_per_day_kg: 6.5, feed_wastage_pct: 3.00, std_body_weight_kg: 152.0, std_mortality_rate_pct: 0.3, output_item_code: 'LVS-PIGLET', output_uom: 'PCS', std_output_qty: 10.5, kpi_lower_limit: 9.5, kpi_upper_limit: 13.0, alert_severity: 'WARNING'  as const, notes: 'Good milking ability. Target 10.5 weaned/litter.' },
    { breed_code, stage_code: 'WEANING',           calc_unit: 'DAY' as const, period_from: 1, period_to: 1, output_item_code: 'LVS-PIGLET', output_uom: 'PCS', std_output_qty: 10.5, std_mortality_rate_pct: 0.0, alert_severity: 'INFO'    as const, notes: 'Weaning weight target 6.5 kg.' },
    { breed_code, stage_code: 'BOAR_AI',           calc_unit: 'WEEK' as const, period_from: 1, period_to: 104, feed_item_code: 'LVS-PIG-FEED', feed_qty_per_head_per_day_kg: 2.8, feed_wastage_pct: 3.00, std_body_weight_kg: 195.0, std_mortality_rate_pct: 0.0, kpi_lower_limit: 3.0, kpi_upper_limit: 6.0, alert_severity: 'WARNING'  as const, notes: 'Landrace boar AI station standard protocol.' },
    { breed_code, stage_code: 'CB_GROWER',         calc_unit: 'DAY' as const, period_from: 1, period_to: 77,  feed_item_code: 'LVS-PIG-FEED', feed_qty_per_head_per_day_kg: 2.5, feed_wastage_pct: 5.00, std_body_weight_kg: 112.0, std_adg_gpd: 770, std_fcr: 2.85, std_mortality_rate_pct: 1.5, output_item_code: 'LVS-DRESSED-PORK', output_uom: 'KG', std_output_qty: 80.0, kpi_lower_limit: 680, kpi_upper_limit: 950, alert_severity: 'CRITICAL' as const, notes: 'Slightly lower FCR than Yorkshire in finisher. Monitor closely.' },
    { breed_code, stage_code: 'SLAUGHTER',         calc_unit: 'DAY' as const, period_from: 1, period_to: 1, output_item_code: 'LVS-DRESSED-PORK', output_uom: 'KG', std_output_qty: 80.0, std_mortality_rate_pct: 0.0, alert_severity: 'INFO'    as const, notes: 'Record live weight, dressed weight, dressing pct.' },
    { breed_code, stage_code: 'DISPOSED',          calc_unit: 'DAY' as const, period_from: 1, period_to: 1, std_mortality_rate_pct: 0.0, alert_severity: 'INFO'    as const, notes: 'Record disposal reason.' },
  ]),

  // -- DUROC (terminal sire -- fastest CB growth, best FCR, fewer piglets) ----------
  ...(['DUROC'] as const).flatMap((breed_code) => [
    { breed_code, stage_code: 'QUARANTINE',        calc_unit: 'DAY' as const, period_from: 1, period_to: 30,  feed_item_code: 'LVS-PIG-FEED', feed_qty_per_head_per_day_kg: 1.8, feed_wastage_pct: 5.00, std_body_weight_kg: 48.0,  std_adg_gpd: 420, std_fcr: 4.00, std_mortality_rate_pct: 1.0, kpi_lower_limit: 350, kpi_upper_limit: 550, alert_severity: 'WARNING'  as const, notes: 'Duroc grows faster in quarantine. Same health protocol applies.' },
    { breed_code, stage_code: 'GILT_GROWER',       calc_unit: 'DAY' as const, period_from: 1, period_to: 77,  feed_item_code: 'LVS-PIG-FEED', feed_qty_per_head_per_day_kg: 2.3, feed_wastage_pct: 5.00, std_body_weight_kg: 130.0, std_adg_gpd: 900, std_fcr: 2.60, std_mortality_rate_pct: 0.5, kpi_lower_limit: 800, kpi_upper_limit: 1050, alert_severity: 'WARNING' as const, notes: 'Higher ADG than maternal breeds. Service weight 125-140 kg.' },
    { breed_code, stage_code: 'FLUSH_SERVICE',     calc_unit: 'DAY' as const, period_from: 1, period_to: 10,  feed_item_code: 'LVS-PIG-FEED', feed_qty_per_head_per_day_kg: 3.0, feed_wastage_pct: 5.00, std_body_weight_kg: 133.0, std_mortality_rate_pct: 0.2, alert_severity: 'INFO'    as const, notes: 'Farrowing rate 82%. Confirm scan Day 21.' },
    { breed_code, stage_code: 'DRY_SOW_GESTATION', calc_unit: 'DAY' as const, period_from: 1, period_to: 114, feed_item_code: 'LVS-PIG-FEED', feed_qty_per_head_per_day_kg: 2.7, feed_wastage_pct: 3.00, std_body_weight_kg: 175.0, std_adg_gpd: 320, std_mortality_rate_pct: 0.3, kpi_lower_limit: 250, kpi_upper_limit: 480, alert_severity: 'WARNING'  as const, notes: 'Heavier sow requires slightly higher gestation ration.' },
    { breed_code, stage_code: 'FARROWING',         calc_unit: 'DAY' as const, period_from: 1, period_to: 3,   feed_item_code: 'LVS-PIG-FEED', feed_qty_per_head_per_day_kg: 1.5, feed_wastage_pct: 0, output_item_code: 'LVS-PIGLET', output_uom: 'PCS', std_output_qty: 10.0, std_mortality_rate_pct: 0.5, kpi_lower_limit: 8.0, kpi_upper_limit: 13.0, alert_severity: 'CRITICAL' as const, notes: 'Lower litter size typical of terminal sire. Piglets heavier at birth.' },
    { breed_code, stage_code: 'LACTATION',         calc_unit: 'DAY' as const, period_from: 1, period_to: 27,  feed_item_code: 'LVS-PIG-FEED', feed_qty_per_head_per_day_kg: 6.5, feed_wastage_pct: 3.00, std_body_weight_kg: 158.0, std_mortality_rate_pct: 0.3, output_item_code: 'LVS-PIGLET', output_uom: 'PCS', std_output_qty: 8.5, kpi_lower_limit: 7.5, kpi_upper_limit: 11.0, alert_severity: 'WARNING'  as const, notes: 'Duroc 27-day lactation. Heavier piglets at weaning (target 7.5 kg).' },
    { breed_code, stage_code: 'WEANING',           calc_unit: 'DAY' as const, period_from: 1, period_to: 1, output_item_code: 'LVS-PIGLET', output_uom: 'PCS', std_output_qty: 8.5, std_mortality_rate_pct: 0.0, alert_severity: 'INFO'    as const, notes: 'Weaning weight target 7.5 kg -- heavier than maternal breeds.' },
    { breed_code, stage_code: 'BOAR_AI',           calc_unit: 'WEEK' as const, period_from: 1, period_to: 130, feed_item_code: 'LVS-PIG-FEED', feed_qty_per_head_per_day_kg: 3.0, feed_wastage_pct: 3.00, std_body_weight_kg: 230.0, std_mortality_rate_pct: 0.0, kpi_lower_limit: 4.0, kpi_upper_limit: 7.0, alert_severity: 'WARNING'  as const, notes: 'Duroc boar extended productive life (30 months). Higher dose count.' },
    { breed_code, stage_code: 'CB_GROWER',         calc_unit: 'DAY' as const, period_from: 1, period_to: 77,  feed_item_code: 'LVS-PIG-FEED', feed_qty_per_head_per_day_kg: 2.6, feed_wastage_pct: 5.00, std_body_weight_kg: 120.0, std_adg_gpd: 950, std_fcr: 2.55, std_mortality_rate_pct: 1.5, output_item_code: 'LVS-DRESSED-PORK', output_uom: 'KG', std_output_qty: 88.0, kpi_lower_limit: 850, kpi_upper_limit: 1100, alert_severity: 'CRITICAL' as const, notes: 'Best FCR of the 4 breeds. Premium terminal sire for market pigs.' },
    { breed_code, stage_code: 'SLAUGHTER',         calc_unit: 'DAY' as const, period_from: 1, period_to: 1, output_item_code: 'LVS-DRESSED-PORK', output_uom: 'KG', std_output_qty: 88.0, std_mortality_rate_pct: 0.0, alert_severity: 'INFO'    as const, notes: 'Higher dressing percentage expected. Record condemnations.' },
    { breed_code, stage_code: 'DISPOSED',          calc_unit: 'DAY' as const, period_from: 1, period_to: 1, std_mortality_rate_pct: 0.0, alert_severity: 'INFO'    as const, notes: 'Record disposal reason.' },
  ]),
];

/** Preserve illustrative feed benchmarks only where the BBP stage identity is
 * unambiguous. Do not split the old combined flushing/service profile by guess. */
export const SYSTEM_BREED_LIFECYCLE_SEED: typeof LEGACY_BREED_LIFECYCLE_SEED = LEGACY_BREED_LIFECYCLE_SEED.flatMap((row) => {
  const code = BBP_STAGE_RENAMES[row.stage_code] || row.stage_code;
  const stage = SYSTEM_STAGE_SEED.find((entry) => entry.stage_code === code);
  if (!stage) return [];
  return [{ ...row, stage_code: code, period_to: stage.typical_duration_days ?? row.period_to,
    notes: 'Illustrative demo benchmark, not a client-approved feeding protocol. Stage duration aligned to BBP §1.7; confirm breed-specific targets before live use.' }];
});
