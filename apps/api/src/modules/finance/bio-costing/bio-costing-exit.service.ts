import { BadRequestException, Injectable } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, eq, lte, sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { assertPostingPeriodOpen } from '../../../common/period-close';
import { JournalService } from '../journal/journal.service';

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
export const EXIT_JOURNAL_TYPE = 'BIO_ASSET_EXIT';

export type ClearResult =
  | { cleared: number; journal_no: string; journal_id: string }
  | { cleared: 0; reason: 'NO_PROFILE' | 'NOT_AMORTISED' | 'NOTHING_AMORTISED' | 'ALREADY_CLEARED' };

/**
 * What an animal's exit does to the accumulated-amortisation account (bio-asset costing, Phase 4).
 *
 * BBP S.NO.7, a breeding asset that dies: "Debit: Mortality / Impairment Loss, Debit: Accumulated Amortization, where applicable,
 * Credit: Respective Biological Asset Acquisition Cost". The death journal the batch already posts is the loss leg; this is the
 * accumulated-amortisation leg: Dr accumulated amortisation / Cr acquisition cost, for what the animal has been amortised to date.
 * Without it the credit the runs built up stays in the account for an animal that is gone. The entry leaves the net asset as it was
 * (the contra and the gross fall together); the loss on the acquisition cost itself waits for the registration posting (D8).
 *
 * A sale, cull or slaughter is a different entry (BBP S.NO.8: amortisation reversed to the transfer date, or cleared against cost of
 * sales, depending on the route) and is not built: the animal's sale posts no journal at all today.
 */
@Injectable()
export class BioCostingExitService {
  constructor(private readonly cls: ClsService, private readonly journals: JournalService) {}

  private get db(): MySql2Database<typeof schema> {
    const db = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('Tenant database connection context not established.');
    return db;
  }

  async clearOnDeath(animalId: string, deathDate: string, tenantId: string, userId?: string): Promise<ClearResult> {
    const [animal] = await this.db.select().from(schema.animalRegister)
      .where(and(eq(schema.animalRegister.animal_id, animalId), eq(schema.animalRegister.tenant_id, tenantId))).limit(1);
    if (!animal?.costing_profile_id) return { cleared: 0, reason: 'NO_PROFILE' };
    const [profile] = await this.db.select().from(schema.bioCostingProfile).where(eq(schema.bioCostingProfile.profile_id, animal.costing_profile_id)).limit(1);
    if (!profile || profile.costing_method !== 'AMORTIZATION') return { cleared: 0, reason: 'NOT_AMORTISED' };

    // Once only: a second call (a retry) finds the first journal and does nothing.
    const [done] = await this.db.select({ id: schema.journalHeader.journal_id }).from(schema.journalHeader).where(and(
      eq(schema.journalHeader.source_document_type, EXIT_JOURNAL_TYPE), eq(schema.journalHeader.source_document_no, animal.animal_code),
      eq(schema.journalHeader.status, 'POSTED'), eq(schema.journalHeader.company_id, animal.company_id))).limit(1);
    if (done) return { cleared: 0, reason: 'ALREADY_CLEARED' };

    const [sum] = await this.db.select({ total: sql<string>`COALESCE(SUM(${schema.bioAssetLedger.cost_amount}), 0)` }).from(schema.bioAssetLedger).where(and(
      eq(schema.bioAssetLedger.animal_id, animalId), eq(schema.bioAssetLedger.entry_type, 'AMORTIZATION'), lte(schema.bioAssetLedger.posting_date, deathDate)));
    const amortised = r4(-Number(sum?.total ?? 0)); // the ledger holds charges as negatives
    if (amortised < 0.005) return { cleared: 0, reason: 'NOTHING_AMORTISED' };
    if (!profile.accum_amort_gl_id || !profile.acquisition_gl_id) {
      throw new BadRequestException(`Profile ${profile.profile_code} has amortised ${animal.animal_code} but lacks the accumulated-amortisation or acquisition-cost GL account to clear it.`);
    }
    await assertPostingPeriodOpen(this.db, { tenantId, companyId: animal.company_id, postingDate: deathDate });

    const journal = await this.journals.createAndPostSystemJournal({
      tenantId, companyId: animal.company_id, postingDate: deathDate, sourceDocumentType: EXIT_JOURNAL_TYPE, sourceDocumentNo: animal.animal_code,
      description: `Accumulated amortization cleared on death - ${animal.animal_code} (${profile.profile_code})`, userId,
      lines: [
        { glAccountId: profile.accum_amort_gl_id, debitAmount: amortised, creditAmount: 0, nobId: animal.nob_id, lobId: animal.lob_id, description: `Clear accumulated amortization ${animal.animal_code}` },
        { glAccountId: profile.acquisition_gl_id, debitAmount: 0, creditAmount: amortised, nobId: animal.nob_id, lobId: animal.lob_id, description: `Clear accumulated amortization ${animal.animal_code}` },
      ],
    }) as { journal_id: string; journal_no: string };
    return { cleared: amortised, journal_no: journal.journal_no, journal_id: journal.journal_id };
  }
}
