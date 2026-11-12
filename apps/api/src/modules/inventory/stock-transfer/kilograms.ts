import type { UomService } from '../../master-data/uom/uom.service';

/**
 * A quantity in kilograms through the UOM conversions (item-specific first, then global). Throws when no conversion
 * is configured; each caller words its own refusal. Shared by the Transfer Order silo capacity check and Logistics
 * trip weights.
 */
export async function quantityInKilograms(
  uomService: Pick<UomService, 'resolveConversionFactor'>,
  quantity: number,
  uom: string,
  itemId: string,
  companyId: string,
  tenantId: string,
): Promise<number> {
  const unit = (uom || '').toUpperCase().trim();
  const factor = await uomService.resolveConversionFactor(unit, 'KG', itemId, companyId, tenantId);
  return quantity * factor;
}
