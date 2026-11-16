import { BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import * as schema from '../../../core/database/schema';
import { SpecLineInput, specLineFromParameter } from '../../inventory/qc-inspection/qc-inspection.rules';

/**
 * The item card's QC Specification adds checks from the QC Parameter Master (client, 9 Nov). A line that names a parameter is linked to it and
 * takes its QC Code and QC Type from it; Description, Unit, Min / Max / Target and Mandatory are the item's own (an item's range may differ from
 * the master's), and the master's value fills any of them not sent. The parameter must be an active one of the item's own company. A line
 * without a parameter is kept as sent.
 */
export async function linesFromQcParameters(
  db: MySql2Database<typeof schema>,
  lines: SpecLineInput[],
  scope: { tenantId: string; companyId: string | null },
): Promise<SpecLineInput[]> {
  const ids = [...new Set(lines.map((l) => l.param_id).filter((id): id is string => !!id))];
  if (!ids.length) return lines;

  const params = await db
    .select()
    .from(schema.qcParameterMaster)
    .where(
      and(
        inArray(schema.qcParameterMaster.param_id, ids),
        eq(schema.qcParameterMaster.tenant_id, scope.tenantId),
        scope.companyId
          ? eq(schema.qcParameterMaster.company_id, scope.companyId)
          : isNull(schema.qcParameterMaster.company_id),
      ),
    );
  const byId = new Map(params.map((p) => [p.param_id, p]));

  return lines.map((line) => {
    if (!line.param_id) return line;
    const param = byId.get(line.param_id);
    if (!param) throw new BadRequestException(`QC parameter '${line.param_id}' is not in this company's QC Parameter Master.`);
    if (!param.is_active) throw new BadRequestException(`QC parameter '${param.param_code}' is not active.`);
    const master = specLineFromParameter(param);
    // Not sent (undefined) takes the master's value; null clears it for this item.
    const own = <T>(sent: T | undefined, fallback: T) => (sent !== undefined ? sent : fallback);
    return {
      ...master,
      measurement_description: line.measurement_description?.trim() || master.measurement_description,
      uom: own(line.uom, master.uom),
      min_value: own(line.min_value, master.min_value),
      max_value: own(line.max_value, master.max_value),
      target_value: own(line.target_value, master.target_value),
      is_mandatory: line.is_mandatory ?? master.is_mandatory,
      stage: line.stage,
    };
  });
}
