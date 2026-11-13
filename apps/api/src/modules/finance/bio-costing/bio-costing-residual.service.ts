import { Injectable, NotFoundException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, desc, eq, sql } from 'drizzle-orm';
import { addDays, periodFor } from './bio-costing.engine';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { animalScopeConditions, farmScope } from '../../../common/farm-scope';
import { resolveResidual } from './bio-costing.rules';
import { BioCostingSubjectService } from './bio-costing-subject.service';
import { bioEventCondition } from '../../inventory/bio-asset-ledger/bio-asset-ledger.types';

/**
 * An animal's residual: the figure her item's Bio Asset Costing tab gives (150 kg x 2.05 for a sow, none for a boar). It is the item's alone; the animal has none of her own.
 * The run and the animal card both read it here, so there is one answer to "what is her residual".
 */
@Injectable()
export class BioCostingResidualService {
  constructor(private readonly cls: ClsService, private readonly subjects: BioCostingSubjectService) {}

  private get db(): MySql2Database<typeof schema> {
    const db = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('Tenant database connection context not established.');
    return db;
  }

  private async loadAnimal(animalId: string, tenantId: string) {
    const A = schema.animalRegister;
    const [animal] = await this.db.select().from(A).where(and(eq(A.animal_id, animalId), eq(A.tenant_id, tenantId), ...animalScopeConditions(farmScope(this.cls)))).limit(1);
    if (!animal) throw new NotFoundException(`Animal '${animalId}' not found.`);
    return animal;
  }

  /** The residual an animal is written down to, and where it comes from: her item's, or none (no item costs her). */
  async forAnimal(animalId: string, tenantId: string) {
    const animal = await this.loadAnimal(animalId, tenantId);
    const subject = await this.subjects.forAnimal(animalId);
    const resolved = subject ? resolveResidual({ terms: subject.terms, gender: animal.gender }) : { value: 0, source: 'NONE' as const };
    // The latest month's amortisation she has actually been charged (a reversed month nets to nothing and is passed over).
    const L = schema.bioAssetLedger;
    const [latest] = await this.db.select({ date: L.posting_date, total: sql<string>`SUM(${L.cost_amount})` }).from(L)
      .where(and(eq(L.animal_id, animalId), bioEventCondition(L, 'AMORTIZATION')))
      .groupBy(L.posting_date).having(sql`SUM(${L.cost_amount}) < 0`).orderBy(desc(L.posting_date)).limit(1);
    // The last period she was costed in (a posted run that has not been reversed) and the date the next one falls due: TDD row 8's Last Run and Due Date.
    const R = schema.bioCostingRun;
    const [lastRun] = await this.db.select({ end: sql<string>`MAX(${R.period_end})` }).from(schema.bioCostingRunLine)
      .innerJoin(R, eq(R.run_id, schema.bioCostingRunLine.run_id))
      .where(and(eq(schema.bioCostingRunLine.animal_id, animalId), eq(R.status, 'POSTED')));
    const lastRunDate = lastRun?.end ? String(lastRun.end).slice(0, 10) : null;
    const frequency = (subject as { run_frequency?: string } | null)?.run_frequency ?? null;
    const nextDueDate = lastRunDate && frequency ? periodFor(frequency, addDays(lastRunDate, 1)).end : null;
    return {
      animal_id: animalId, residual: resolved.value, source: resolved.source, item_id: animal.item_id,
      // How her item costs her (AMORTIZATION or FAIR_VALUE), so the card shows the figures that belong to that method.
      costing_method: subject?.costing_method ?? subject?.terms?.costing_method ?? null, costing_item_code: subject?.code ?? null,
      latest_amortisation: latest ? Math.abs(Number(latest.total)) : null, latest_amortisation_date: latest?.date ?? null,
      last_run_date: lastRunDate, next_due_date: nextDueDate,
    };
  }
}
