import { BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, eq, isNull } from 'drizzle-orm';
import * as schema from '../../../core/database/schema';

/**
 * A feed line's daily amount per head is entered in a weight UOM (0195), while every consumer —
 * scheduler_line.standard_qty, the forecast, the requisition — reads kilograms. This is the one
 * place that converts between them, so a stage's feed and a scheduler's feed cannot disagree
 * about what a GRAM is.
 */

/** Kilograms in one unit of a weight UOM: the common ones by code, others from UOM Conversion (to KG). */
export const KG_PER_UOM: Record<string, number> = {
  KG: 1, KGS: 1, GRAM: 0.001, GRAMS: 0.001, G: 0.001, GM: 0.001, TONNE: 1000, MT: 1000, TON: 1000, LB: 0.45359237,
};

/**
 * The kilograms one unit of `uom` is worth. Falls back to a tenant's UOM Conversion row to KG.
 * `label` names the offending line in the refusal, because the caller knows its position.
 */
export async function kgPerUom(
  db: MySql2Database<typeof schema>,
  uomCode: string | null | undefined,
  label: string,
): Promise<number> {
  const uom = (uomCode || 'KG').toUpperCase();
  let factor = KG_PER_UOM[uom];
  if (factor === undefined) {
    const [conv] = await db
      .select({ f: schema.uomConversionMaster.conversion_factor })
      .from(schema.uomConversionMaster)
      .where(and(
        eq(schema.uomConversionMaster.from_uom, uom),
        eq(schema.uomConversionMaster.to_uom, 'KG'),
        isNull(schema.uomConversionMaster.item_id),
        eq(schema.uomConversionMaster.is_active, true),
        isNull(schema.uomConversionMaster.deleted_at),
      ))
      .limit(1);
    factor = conv ? Number(conv.f) : (undefined as unknown as number);
  }
  if (factor === undefined || !Number.isFinite(factor) || factor <= 0) {
    throw new BadRequestException(
      `${label}: UOM ${uom} has no conversion to KG. Pick a weight UOM, or add a ${uom} to KG conversion in UOM Conversion.`,
    );
  }
  return factor;
}

/** `qty` of `uom`, in kilograms, rounded the way the feed columns store it. */
export async function feedQtyToKg(
  db: MySql2Database<typeof schema>,
  qty: number,
  uomCode: string | null | undefined,
  label: string,
): Promise<{ uom: string; kg: number }> {
  const uom = (uomCode || 'KG').toUpperCase();
  const factor = await kgPerUom(db, uom, label);
  return { uom, kg: Number((qty * factor).toFixed(4)) };
}
