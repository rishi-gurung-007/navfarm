import { Injectable, NotFoundException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { BadRequestException } from '@nestjs/common';
import { costingStartDate } from './bio-costing.rules';
import { itemHasCostingTerms, itemStartAge } from './bio-costing-subject';
import { animalHasCostingBookings } from './bio-costing-start';
import type { AssignBioCostingDto } from './bio-costing-assign.dto';

/**
 * When an animal's costing begins, from her item's start period (the TDD Item Card). An animal needs no profile: her item's terms cost her, and the only thing
 * stored on her is the date her costing starts (birth + the item's weeks and days, never before she arrived). This sets it at registration, moves it when
 * her birth date changes (while nothing is booked on the old date), and gives it to animals that have none (the backfill's `assign-animals`).
 */
@Injectable()
export class BioCostingStartService {
  constructor(private readonly cls: ClsService) {}

  private get db(): MySql2Database<typeof schema> {
    const db = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('Tenant database connection context not established.');
    return db;
  }

  /**
   * Gives an animal the date her costing begins, from her item. An animal that already has one keeps it. An item with no costing terms leaves her uncosted (not
   * an error: reason ITEM_HAS_NO_COSTING_TERMS).
   */
  async assignAnimal(animalId: string, tenantId: string, opts: { dryRun?: boolean } = {}) {
    const [a] = await this.db.select().from(schema.animalRegister)
      .where(and(eq(schema.animalRegister.animal_id, animalId), eq(schema.animalRegister.tenant_id, tenantId))).limit(1);
    if (!a) throw new NotFoundException(`Animal '${animalId}' not found.`);
    const [item] = await this.db.select().from(schema.itemMaster).where(eq(schema.itemMaster.item_id, a.item_id)).limit(1);
    if (!item || !itemHasCostingTerms(item)) return { animal_id: animalId, assigned: false, reason: 'ITEM_HAS_NO_COSTING_TERMS' as const };
    if (a.costing_start_date) return { animal_id: animalId, assigned: false, reason: 'ALREADY_ASSIGNED' as const, item_id: item.item_id };
    if (!a.is_active) return { animal_id: animalId, assigned: false, reason: 'NOT_ACTIVE' as const };
    const { weeks, days } = itemStartAge(item);
    const start = costingStartDate({ dob: a.dob, entry_date: a.entry_date, age_at_entry_weeks: a.age_at_entry_weeks }, weeks, days);
    if (!opts.dryRun) await this.db.update(schema.animalRegister).set({ costing_start_date: start }).where(eq(schema.animalRegister.animal_id, animalId));
    return { animal_id: animalId, assigned: !opts.dryRun, would_assign: !!opts.dryRun, reason: 'OK' as const, item_id: item.item_id, item_code: item.item_code, costing_start_date: start };
  }

  /**
   * An animal's birth date sets when her costing starts (birth + her item's start period, never before she arrived). Moving the birth date moves that start, and
   * with it the line between feed capitalised and feed expensed and the end of her life, so it is allowed only while nothing has been booked on the old basis: no
   * costing run line, no capitalised or amortised ledger row, no feed or overhead entry against her. Returns the new start, or null when no item costs her.
   */
  async startForNewBirthDate(animalId: string, newDob: string, tenantId: string): Promise<string | null> {
    const [a] = await this.db.select().from(schema.animalRegister)
      .where(and(eq(schema.animalRegister.animal_id, animalId), eq(schema.animalRegister.tenant_id, tenantId))).limit(1);
    if (!a) return null;
    const [item] = await this.db.select().from(schema.itemMaster).where(eq(schema.itemMaster.item_id, a.item_id)).limit(1);
    if (!item || !itemHasCostingTerms(item)) return null;
    if (await animalHasCostingBookings(this.db, animalId)) {
      throw new BadRequestException(
        `${a.animal_code}'s birth date sets when her costing starts, so it cannot be changed once feed, medicine, overhead or a costing run has been booked to her. Reverse those first, or leave the birth date as recorded.`,
      );
    }
    const { weeks, days } = itemStartAge(item);
    return costingStartDate({ dob: newDob, entry_date: String(a.entry_date).slice(0, 10), age_at_entry_weeks: a.age_at_entry_weeks }, weeks, days);
  }

  /** Dates the live animals of the company that have no costing start date (or the ones named), one by one: an animal her item cannot cost is reported and the rest carry on. */
  async assignAnimals(dto: AssignBioCostingDto, tenantId: string, companyId: string) {
    const A = schema.animalRegister;
    const rows = await this.db.select({ animal_id: A.animal_id }).from(A).where(and(
      eq(A.tenant_id, tenantId), eq(A.company_id, companyId), eq(A.is_active, true), isNull(A.costing_start_date),
      ...(dto.animal_ids?.length ? [inArray(A.animal_id, dto.animal_ids)] : [])));
    const results: Array<{ animal_id: string; reason: string } & Record<string, unknown>> = [];
    for (const r of rows) results.push(await this.assignAnimal(r.animal_id, tenantId, { dryRun: dto.dry_run }));
    const by: Record<string, number> = {};
    for (const r of results) by[r.reason] = (by[r.reason] ?? 0) + 1;
    return { dry_run: !!dto.dry_run, considered: results.length, by_reason: by, animals: results };
  }
}
