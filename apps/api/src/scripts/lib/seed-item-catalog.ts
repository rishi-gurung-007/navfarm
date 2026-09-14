/**
 * The demo item catalogues, and the one way to find a seeded item again.
 *
 * `key` is the seed's own handle — RAW-MAIZE-CORN — and is NOT what lands in
 * item_master.item_code. The code comes from the ITEM series, which composes
 * <item_type>-<category_code>-<sub_category>-ITM-<seq>, so it is not known
 * until insert time and changes whenever the category codes do.
 *
 * The three seed scripts used to find items by their hand-written code, which
 * silently stopped matching the moment the code was generated. They resolve by
 * `key` now, via loadItemsByKey(), which joins on item_name — the one property
 * of a seeded item that the numbering cannot move.
 */
import { eq } from 'drizzle-orm';
import * as schema from '../../core/database/schema';

export interface SeedItem {
  key: string;
  name: string;
  type: string;
  cat: string;
  /** Finer classification inside the category; the ITEM series' third segment. */
  sub: string;
  uom: string;
  val: string;
  cost: string;
  bio: boolean;
}

/**
 * Root categories used by the demo item catalogues. `key` is only a stable
 * seed handle; the stored code is generated from ITEM_CATEGORY.
 */
export const ITEM_CATEGORY_CATALOG = [
  { key: 'CAT-RAW-GRAINS', name: 'Raw Grains & Cereals', itemType: 'RAW_MATERIAL' },
  { key: 'CAT-PROTEIN-SUPP', name: 'Protein Meals & Supplements', itemType: 'RAW_MATERIAL' },
  { key: 'CAT-FEED-PREMIX', name: 'Vitamins & Mineral Premixes', itemType: 'RAW_MATERIAL' },
  { key: 'CAT-SWINE-FEEDS', name: 'Finished Swine Feeds & Diets', itemType: 'FEED' },
  { key: 'CAT-VET-MEDS', name: 'Veterinary Medicines & Antibiotics', itemType: 'MEDICINE' },
  { key: 'CAT-VET-VACCINES', name: 'Swine Immunization Vaccines', itemType: 'VACCINE' },
  { key: 'CAT-BIO-BREEDING', name: 'Biological Assets - Breeding Stock', itemType: 'LIVESTOCK' },
  { key: 'CAT-BIO-COMMERCIAL', name: 'Biological Assets - Grower & Finisher', itemType: 'LIVESTOCK' },
] as const;

/**
 * A subcategory is another item_category_master row parented to a root. Items
 * store that child's generated category_code in item_master.sub_category.
 * Keeping the definition here prevents the seed from writing free-text values
 * which the Item form can never resolve through its child-category picker.
 */
export const ITEM_SUBCATEGORY_CATALOG = [
  { key: 'CEREAL', parent: 'CAT-RAW-GRAINS', name: 'Cereals' },
  { key: 'PROTEIN', parent: 'CAT-PROTEIN-SUPP', name: 'Protein Meals' },
  { key: 'PREMIX', parent: 'CAT-FEED-PREMIX', name: 'Premixes' },
  { key: 'CREEP_FEED', parent: 'CAT-SWINE-FEEDS', name: 'Creep Feed' },
  { key: 'GESTATION_FEED', parent: 'CAT-SWINE-FEEDS', name: 'Gestation Feed' },
  { key: 'LACTATION_FEED', parent: 'CAT-SWINE-FEEDS', name: 'Lactation Feed' },
  { key: 'GROWER_FEED', parent: 'CAT-SWINE-FEEDS', name: 'Grower Feed' },
  { key: 'FINISHER_FEED', parent: 'CAT-SWINE-FEEDS', name: 'Finisher Feed' },
  { key: 'INJECTABLE', parent: 'CAT-VET-MEDS', name: 'Injectable Medicine' },
  { key: 'ANTIBIOTIC', parent: 'CAT-VET-MEDS', name: 'Antibiotics' },
  { key: 'HORMONE', parent: 'CAT-VET-MEDS', name: 'Hormones' },
  { key: 'ANTIPARASITIC', parent: 'CAT-VET-MEDS', name: 'Antiparasitics' },
  { key: 'BREEDING_VACCINE', parent: 'CAT-VET-VACCINES', name: 'Breeding Vaccines' },
  { key: 'RESPIRATORY_VACCINE', parent: 'CAT-VET-VACCINES', name: 'Respiratory Vaccines' },
  { key: 'PIGLET_LIVESTOCK', parent: 'CAT-BIO-COMMERCIAL', name: 'Piglets' },
  { key: 'GILT_LIVESTOCK', parent: 'CAT-BIO-BREEDING', name: 'Gilts' },
  { key: 'SOW_LIVESTOCK', parent: 'CAT-BIO-BREEDING', name: 'Sows' },
  { key: 'BOAR_LIVESTOCK', parent: 'CAT-BIO-BREEDING', name: 'Boars' },
  { key: 'FINISHER_LIVESTOCK', parent: 'CAT-BIO-COMMERCIAL', name: 'Finisher Pigs' },
  { key: 'CARCASS', parent: 'CAT-BIO-COMMERCIAL', name: 'Finished Carcass' },
] as const;

export const ITEM_CATALOG_1: SeedItem[] = [
      { key: 'RAW-MAIZE-CORN', name: 'Yellow Feed Maize / Corn Grains', type: 'RAW_MATERIAL', cat: 'CAT-RAW-GRAINS', sub: 'CEREAL', uom: 'KG', val: 'FIFO', cost: '22.0000', bio: false },
      { key: 'RAW-SOYA-MEAL', name: 'De-hulled Soya Meal (46% CP)', type: 'RAW_MATERIAL', cat: 'CAT-PROTEIN-SUPP', sub: 'PROTEIN', uom: 'KG', val: 'FIFO', cost: '42.0000', bio: false },
      { key: 'RAW-WHEAT-BRAN', name: 'Coarse Wheat Bran (14% CP)', type: 'RAW_MATERIAL', cat: 'CAT-RAW-GRAINS', sub: 'CEREAL', uom: 'KG', val: 'FIFO', cost: '18.5000', bio: false },
      { key: 'RAW-FISH-MEAL', name: 'Steam-Dried Fish Meal (60% CP)', type: 'RAW_MATERIAL', cat: 'CAT-PROTEIN-SUPP', sub: 'PROTEIN', uom: 'KG', val: 'FIFO', cost: '65.0000', bio: false },
      { key: 'RAW-SWINE-PREMIX', name: 'Swine Vitamin & Trace Mineral Premix', type: 'RAW_MATERIAL', cat: 'CAT-FEED-PREMIX', sub: 'PREMIX', uom: 'KG', val: 'FIFO', cost: '180.0000', bio: false },
      { key: 'RAW-WHEY-POWDER', name: 'Spray Dried Sweet Whey Powder', type: 'RAW_MATERIAL', cat: 'CAT-FEED-PREMIX', sub: 'PREMIX', uom: 'KG', val: 'FIFO', cost: '95.0000', bio: false },
      { key: 'FEED-CREEP-PRE', name: 'Creep Feed Pre-Starter (22% CP)', type: 'FEED', cat: 'CAT-SWINE-FEEDS', sub: 'CREEP_FEED', uom: 'KG', val: 'FIFO', cost: '55.0000', bio: false },
      { key: 'FEED-GEST-SOW', name: 'Dry Sow Gestation Mash (14% CP)', type: 'FEED', cat: 'CAT-SWINE-FEEDS', sub: 'GESTATION_FEED', uom: 'KG', val: 'FIFO', cost: '28.0000', bio: false },
      { key: 'FEED-LACT-SOW', name: 'High-Density Lactation Diet (17.5% CP)', type: 'FEED', cat: 'CAT-SWINE-FEEDS', sub: 'LACTATION_FEED', uom: 'KG', val: 'FIFO', cost: '38.0000', bio: false },
      { key: 'MED-IRON-DEX', name: 'Iron Dextran 100mg/ml 100ml Injection', type: 'MEDICINE', cat: 'CAT-VET-MEDS', sub: 'INJECTABLE', uom: 'VIAL', val: 'FIFO', cost: '180.0000', bio: false },
      { key: 'MED-PENICILLIN', name: 'Penicillin G Procaine 300K IU 100ml', type: 'MEDICINE', cat: 'CAT-VET-MEDS', sub: 'ANTIBIOTIC', uom: 'VIAL', val: 'FIFO', cost: '220.0000', bio: false },
      { key: 'MED-OXYTOCIN', name: 'Oxytocin 10 IU/ml 50ml Injection', type: 'MEDICINE', cat: 'CAT-VET-MEDS', sub: 'HORMONE', uom: 'VIAL', val: 'FIFO', cost: '150.0000', bio: false },
      { key: 'MED-IVERMECTIN', name: 'Ivermectin 1% Swine Dewormer 100ml', type: 'MEDICINE', cat: 'CAT-VET-MEDS', sub: 'ANTIPARASITIC', uom: 'VIAL', val: 'FIFO', cost: '280.0000', bio: false },
      { key: 'VAC-PARVO-LEPTO', name: 'Parvo-Shield L5 Swine Vaccine (50 Doses)', type: 'VACCINE', cat: 'CAT-VET-VACCINES', sub: 'BREEDING_VACCINE', uom: 'DOSE', val: 'FIFO', cost: '85.0000', bio: false },
      { key: 'VAC-PRRS-MLV', name: 'Ingelvac PRRS MLV Swine Vaccine (50 Doses)', type: 'VACCINE', cat: 'CAT-VET-VACCINES', sub: 'RESPIRATORY_VACCINE', uom: 'DOSE', val: 'FIFO', cost: '120.0000', bio: false },
      { key: 'BIO-SWINE-PIGLET', name: 'Suckling Live Piglet (0-4 Wks)', type: 'LIVESTOCK', cat: 'CAT-BIO-COMMERCIAL', sub: 'PIGLET_LIVESTOCK', uom: 'HEAD', val: 'BIO_ASSET', cost: '3500.0000', bio: true },
      { key: 'BIO-SWINE-GILT', name: 'Replacement Breeding Gilt', type: 'LIVESTOCK', cat: 'CAT-BIO-BREEDING', sub: 'GILT_LIVESTOCK', uom: 'HEAD', val: 'BIO_ASSET', cost: '18000.0000', bio: true },
      { key: 'BIO-SWINE-SOW', name: 'Mature Parity Breeding Sow', type: 'LIVESTOCK', cat: 'CAT-BIO-BREEDING', sub: 'SOW_LIVESTOCK', uom: 'HEAD', val: 'BIO_ASSET', cost: '28000.0000', bio: true },
      { key: 'BIO-SWINE-BOAR', name: 'Mature Herd Sire Boar', type: 'LIVESTOCK', cat: 'CAT-BIO-BREEDING', sub: 'BOAR_LIVESTOCK', uom: 'HEAD', val: 'BIO_ASSET', cost: '45000.0000', bio: true },
];

export const ITEM_CATALOG_2: SeedItem[] = [
      { key: 'RAW-MAIZE-CORN', name: 'Yellow Feed Maize / Corn Grains', type: 'RAW_MATERIAL', cat: 'CAT-RAW-GRAINS', sub: 'CEREAL', uom: 'KG', val: 'FIFO', cost: '22.0000', bio: false },
      { key: 'RAW-SOYA-MEAL', name: 'De-hulled Soya Meal (46% CP)', type: 'RAW_MATERIAL', cat: 'CAT-PROTEIN-SUPP', sub: 'PROTEIN', uom: 'KG', val: 'FIFO', cost: '42.0000', bio: false },
      { key: 'RAW-WHEAT-BRAN', name: 'Coarse Wheat Bran (14% CP)', type: 'RAW_MATERIAL', cat: 'CAT-RAW-GRAINS', sub: 'CEREAL', uom: 'KG', val: 'FIFO', cost: '18.5000', bio: false },
      { key: 'RAW-SWINE-PREMIX', name: 'Swine Vitamin & Trace Mineral Premix', type: 'RAW_MATERIAL', cat: 'CAT-FEED-PREMIX', sub: 'PREMIX', uom: 'KG', val: 'FIFO', cost: '180.0000', bio: false },
      { key: 'FEED-WEAN-GROW', name: 'Weaner Grower Mash (18% CP)', type: 'FEED', cat: 'CAT-SWINE-FEEDS', sub: 'GROWER_FEED', uom: 'KG', val: 'FIFO', cost: '34.5000', bio: false },
      { key: 'FEED-FINISHER', name: 'Finisher High-Gain Porker Feed (15.5% CP)', type: 'FEED', cat: 'CAT-SWINE-FEEDS', sub: 'FINISHER_FEED', uom: 'KG', val: 'FIFO', cost: '31.0000', bio: false },
      { key: 'MED-IVERMECTIN', name: 'Ivermectin 1% Swine Dewormer 100ml', type: 'MEDICINE', cat: 'CAT-VET-MEDS', sub: 'ANTIPARASITIC', uom: 'VIAL', val: 'FIFO', cost: '280.0000', bio: false },
      { key: 'MED-TYLOSIN', name: 'Tylosin Tartrate 100g Soluble Powder', type: 'MEDICINE', cat: 'CAT-VET-MEDS', sub: 'ANTIBIOTIC', uom: 'PACK', val: 'FIFO', cost: '350.0000', bio: false },
      { key: 'BIO-SWINE-PIGLET', name: 'Weaned Feeder Piglet (7-10kg)', type: 'LIVESTOCK', cat: 'CAT-BIO-COMMERCIAL', sub: 'PIGLET_LIVESTOCK', uom: 'HEAD', val: 'BIO_ASSET', cost: '4200.0000', bio: true },
      { key: 'BIO-SWINE-FINISHER', name: 'Finished Market Porker (105kg Live)', type: 'LIVESTOCK', cat: 'CAT-BIO-COMMERCIAL', sub: 'FINISHER_LIVESTOCK', uom: 'HEAD', val: 'BIO_ASSET', cost: '12500.0000', bio: true },
      { key: 'LVS-DRESSED-PORK', name: 'Dressed Pork Carcass (Wholesale Cut)', type: 'FINISHED_GOODS', cat: 'CAT-BIO-COMMERCIAL', sub: 'CARCASS', uom: 'KG', val: 'FIFO', cost: '185.0000', bio: false },
];

/** name -> seed key, across both catalogues. Names are unique within the demo. */
export const SEED_KEY_BY_ITEM_NAME: Record<string, string> = Object.fromEntries(
  [...ITEM_CATALOG_1, ...ITEM_CATALOG_2].map((i) => [i.name, i.key]),
);

/**
 * A company's items keyed by seed key, so `get('FEED-GEST-SOW')` keeps working
 * regardless of what the ITEM series composed for that item's actual code.
 * Items with no catalogue entry are keyed by their code, so anything seeded
 * outside these catalogues is still reachable.
 */
export async function loadItemsByKey(db: any, companyId: string): Promise<Map<string, any>> {
  const rows = await db.select().from(schema.itemMaster).where(eq(schema.itemMaster.company_id, companyId));
  return new Map(rows.map((r: any) => [SEED_KEY_BY_ITEM_NAME[r.item_name] ?? r.item_code, r]));
}
