/**
 * Pure rules of the gilt class master (migration 0254). BBP-2, "Selection of Gilts for Breeding": the class a gilt takes is set by her parentage. A line is a
 * breed, so a rule names the dam's breed, the sire's breed and the item the gilt is registered as. No database here.
 */
export interface GiltItemFacts {
  item_code: string;
  is_active: boolean | null;
  is_biological_asset: boolean | null;
  bio_gender: string | null;
  bio_costing_method: string | null;
}

/** What is wrong with an item as the gilt's item, as sentences. A gilt is a female breeding animal costed by her item's terms. */
export function giltItemIssues(item: GiltItemFacts | null | undefined): string[] {
  if (!item) return ['The item is not available in this workspace.'];
  const out: string[] = [];
  if (!item.is_active) out.push(`Item ${item.item_code} is switched off.`);
  if (!item.is_biological_asset) out.push(`Item ${item.item_code} is not a biological asset, so a gilt cannot be registered as it.`);
  if (item.bio_gender && item.bio_gender !== 'F') out.push(`Item ${item.item_code} is for males; a gilt is female.`);
  if (item.is_biological_asset && !item.bio_costing_method) out.push(`Item ${item.item_code} has no costing method yet, so her class would have no accounts or terms.`);
  return out;
}

export interface GiltRuleRow {
  rule_id: string;
  company_id: string | null;
  dam_breed_id: string;
  sire_breed_id: string;
  gilt_item_id: string;
  is_active: boolean | null;
}

/** The rule for a pair of parents: the company's own, else a tenant-wide one; inactive rules are not read. */
export function pickGiltRule<R extends GiltRuleRow>(rules: R[], damBreedId: string | null | undefined, sireBreedId: string | null | undefined, companyId: string | null): R | null {
  if (!damBreedId || !sireBreedId) return null;
  const fit = rules.filter((r) => r.is_active !== false && r.dam_breed_id === damBreedId && r.sire_breed_id === sireBreedId && (r.company_id === null || r.company_id === companyId));
  fit.sort((a, b) => Number(b.company_id !== null) - Number(a.company_id !== null));
  return fit[0] ?? null;
}
