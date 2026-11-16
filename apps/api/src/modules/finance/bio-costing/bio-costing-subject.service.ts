import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, eq } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { assertCompanyInScope, farmScope } from '../../../common/farm-scope';
import { itemHasCostingTerms, subjectFromItem, type CostingSubject } from './bio-costing-subject';

export interface SubjectRate {
  farm_id: string | null;
  age_week_from: number;
  effective_from: string;
  expected_weight_kg: string;
  price_per_kg: string;
  costs_to_sell_pct: string | null;
}

/** Loads the item a costing run is made for, as a CostingSubject. See bio-costing-subject.ts. */
@Injectable()
export class BioCostingSubjectService {
  constructor(private readonly cls: ClsService) {}

  private get db(): MySql2Database<typeof schema> {
    const db = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('Tenant database connection context not established.');
    return db;
  }

  async loadItem(itemId: string, tenantId: string): Promise<CostingSubject> {
    const [item] = await this.db.select().from(schema.itemMaster)
      .where(and(eq(schema.itemMaster.item_id, itemId), eq(schema.itemMaster.tenant_id, tenantId))).limit(1);
    if (!item) throw new NotFoundException('Item not found.');
    if (item.company_id) assertCompanyInScope(farmScope(this.cls), item.company_id);
    return subjectFromItem(item);
  }

  /**
   * The item a run was made for. A run made when animals were costed by a costing profile names no item: it is history, can be read and (if posted)
   * reversed, but cannot be recalculated or posted, because the profile no longer costs anyone.
   */
  async ofRun(run: { item_id: string | null; run_no?: string }, tenantId: string): Promise<CostingSubject> {
    if (run.item_id) return this.loadItem(run.item_id, tenantId);
    throw new BadRequestException(`${run.run_no ? `Run ${run.run_no}` : 'This run'} was made for a costing profile, which no longer costs animals. Reverse it if it is posted, or calculate the period again for the item.`);
  }

  /** What costs an animal: her item when it has costing terms, else nothing. Not scoped to the caller's company: it is read while posting her own journals, which are already authorised. */
  async forAnimal(animalId: string): Promise<CostingSubject | null> {
    const [a] = await this.db.select({ item_id: schema.animalRegister.item_id }).from(schema.animalRegister).where(eq(schema.animalRegister.animal_id, animalId)).limit(1);
    if (!a) return null;
    const [item] = await this.db.select().from(schema.itemMaster).where(eq(schema.itemMaster.item_id, a.item_id)).limit(1);
    return item && itemHasCostingTerms(item) ? subjectFromItem(item) : null;
  }

  /** The dated fair-value inputs of an item. */
  async ratesOf(subject: CostingSubject): Promise<SubjectRate[]> {
    return (await this.db.select().from(schema.itemFairValueRate).where(eq(schema.itemFairValueRate.item_id, subject.id)))
      .map((r) => ({ ...r, effective_from: String(r.effective_from).slice(0, 10) }));
  }
}
