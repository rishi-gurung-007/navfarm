import { withTenantTransaction } from '../../../common/tenant-transaction';
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, like, isNull, count, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { CreateJournalDto, UpdateJournalDto, QueryJournalDto } from './dto/journal.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';

const toMysqlTimestamp = (date: Date = new Date()) => {
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

interface SystemJournalLineInput {
  glAccountId: string;
  costCenterId?: string;
  debitAmount: number;
  creditAmount: number;
  description?: string;
  nobId?: string;
  lobId?: string;
}

@Injectable()
export class JournalService {
  constructor(
    private readonly cls: ClsService,
    private readonly auditService: AuditLogService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  // `executor` must be the active transaction when called from inside one (both
  // callers below do this) — `.for('update')` locks the counted rows so a second
  // concurrent call blocks until the first commits its insert, instead of both
  // reading the same count and generating the same journal number. This is the
  // hottest of the document-number generators — every domain's GL auto-posting
  // routes through `createAndPostSystemJournal`.
  private async generateJournalNo(tenantId: string, companyId: string, executor: MySql2Database<typeof schema> = this.db): Promise<string> {
    const [row] = await executor
      .select({ total: count() })
      .from(schema.journalHeader)
      .where(and(eq(schema.journalHeader.tenant_id, tenantId), eq(schema.journalHeader.company_id, companyId)))
      .for('update');
    const seq = Number(row?.total || 0) + 1;
    return `JE-${String(seq).padStart(6, '0')}`;
  }

  private sumLines(lines: { debit_amount?: number; credit_amount?: number }[]) {
    const totalDebit = lines.reduce((sum, l) => sum + (l.debit_amount || 0), 0);
    const totalCredit = lines.reduce((sum, l) => sum + (l.credit_amount || 0), 0);
    return { totalDebit, totalCredit };
  }

  // Manual journal lines carry a client-supplied gl_account_id — the DB FK
  // only guarantees the row exists somewhere in the tenant DB, not that it
  // belongs to this journal's company or is still postable. Without this,
  // a journal for Company A could post against Company B's chart of
  // accounts (both live in the same physical tenant database), or against
  // an account that's since been deactivated.
  private async validateJournalAccounts(companyId: string, lines: { gl_account_id: string }[]) {
    const accountIds = [...new Set(lines.map((l) => l.gl_account_id))];
    const accounts = await this.db
      .select({
        gl_account_id: schema.glAccountMaster.gl_account_id,
        account_code: schema.glAccountMaster.account_code,
        company_id: schema.glAccountMaster.company_id,
        is_active: schema.glAccountMaster.is_active,
      })
      .from(schema.glAccountMaster)
      .where(inArray(schema.glAccountMaster.gl_account_id, accountIds));

    const byId = new Map(accounts.map((a) => [a.gl_account_id, a]));
    for (const id of accountIds) {
      const account = byId.get(id);
      if (!account) {
        throw new BadRequestException(`GL account '${id}' not found.`);
      }
      if (account.company_id !== companyId) {
        throw new BadRequestException(`GL account '${account.account_code}' does not belong to this company.`);
      }
      if (!account.is_active) {
        throw new BadRequestException(`GL account '${account.account_code}' is inactive and cannot be posted to.`);
      }
    }
  }

  // --- Manual journal entries (draft -> post lifecycle) ---

  async create(dto: CreateJournalDto, tenantId: string, userPayload?: any) {
    await this.validateJournalAccounts(dto.company_id, dto.lines);

    const journalId = randomUUID();
    const { totalDebit, totalCredit } = this.sumLines(dto.lines);

    const journalNo = await this.db.transaction(async (tx) => {
      const no = await this.generateJournalNo(tenantId, dto.company_id, tx);
      await tx.insert(schema.journalHeader).values({
        journal_id: journalId,
        tenant_id: tenantId,
        company_id: dto.company_id,
        journal_no: no,
        posting_date: dto.posting_date,
        source: 'MANUAL',
        description: dto.description || null,
        status: 'DRAFT',
        total_debit: totalDebit.toString(),
        total_credit: totalCredit.toString(),
        created_by: userPayload?.userId || null,
        updated_by: userPayload?.userId || null,
      });
      return no;
    });

    await this.insertLines(journalId, dto.lines);

    await this.auditService.log({
      tenantId,
      companyId: dto.company_id,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'journal_header',
      entityId: journalId,
      newValues: { journal_no: journalNo, ...dto },
    });

    return this.findOne(journalId);
  }

  private async insertLines(journalId: string, lines: CreateJournalDto['lines']) {
    await this.db.insert(schema.journalLine).values(
      lines.map((line, idx) => ({
        line_id: randomUUID(),
        journal_id: journalId,
        line_no: idx + 1,
        gl_account_id: line.gl_account_id,
        cost_center_id: line.cost_center_id || null,
        debit_amount: (line.debit_amount || 0).toString(),
        credit_amount: (line.credit_amount || 0).toString(),
        description: line.description || null,
      }))
    );
  }

  async findOne(id: string) {
    const [journal] = await this.db
      .select()
      .from(schema.journalHeader)
      .where(and(eq(schema.journalHeader.journal_id, id), isNull(schema.journalHeader.deleted_at)))
      .limit(1);

    if (!journal) {
      throw new NotFoundException(`Journal Entry with ID '${id}' not found.`);
    }

    const lines = await this.db
      .select()
      .from(schema.journalLine)
      .where(eq(schema.journalLine.journal_id, id));

    return { ...journal, lines };
  }

  async findAll(query: QueryJournalDto, tenantId: string) {
    const conditions: any[] = [eq(schema.journalHeader.tenant_id, tenantId), isNull(schema.journalHeader.deleted_at)];

    if (query.companyId) conditions.push(eq(schema.journalHeader.company_id, query.companyId));
    if (query.status) conditions.push(eq(schema.journalHeader.status, query.status));
    if (query.source) conditions.push(eq(schema.journalHeader.source, query.source));
    if (query.search) conditions.push(like(schema.journalHeader.journal_no, `%${query.search}%`));

    const limit = query.limit || 50;
    const offset = query.offset || 0;

    return this.db
      .select()
      .from(schema.journalHeader)
      .where(and(...conditions))
      .limit(limit)
      .offset(offset);
  }

  private assertDraft(journal: { status: string }) {
    if (journal.status !== 'DRAFT') {
      throw new BadRequestException(`Journal Entry cannot be modified — it is already ${journal.status}.`);
    }
  }

  async update(id: string, dto: UpdateJournalDto, tenantId: string, userPayload?: any) {
    const journal = await this.findOne(id);
    this.assertDraft(journal);

    const updates: any = {
      updated_by: userPayload?.userId || null,
      updated_at: toMysqlTimestamp(),
    };
    if (dto.posting_date !== undefined) updates.posting_date = dto.posting_date;
    if (dto.description !== undefined) updates.description = dto.description;

    if (dto.lines) {
      await this.validateJournalAccounts(journal.company_id, dto.lines);
      const { totalDebit, totalCredit } = this.sumLines(dto.lines);
      updates.total_debit = totalDebit.toString();
      updates.total_credit = totalCredit.toString();
    }

    await this.db.update(schema.journalHeader).set(updates).where(eq(schema.journalHeader.journal_id, id));

    if (dto.lines) {
      await this.db.delete(schema.journalLine).where(eq(schema.journalLine.journal_id, id));
      await this.insertLines(id, dto.lines);
    }

    await this.auditService.log({
      tenantId,
      companyId: journal.company_id,
      userId: userPayload?.userId,
      action: 'UPDATE',
      entityName: 'journal_header',
      entityId: id,
      oldValues: journal,
      newValues: updates,
    });

    return this.findOne(id);
  }

  async remove(id: string, tenantId: string, userPayload?: any) {
    const journal = await this.findOne(id);
    this.assertDraft(journal);
    const deletedTime = toMysqlTimestamp();

    await this.db
      .update(schema.journalHeader)
      .set({ status: 'CANCELLED', deleted_at: deletedTime as any, updated_by: userPayload?.userId || null })
      .where(eq(schema.journalHeader.journal_id, id));

    await this.auditService.log({
      tenantId,
      companyId: journal.company_id,
      userId: userPayload?.userId,
      action: 'DELETE',
      entityName: 'journal_header',
      entityId: id,
      oldValues: journal,
      newValues: { status: 'CANCELLED', deleted_at: deletedTime },
    });

    return { success: true, message: `Journal Entry '${journal.journal_no}' has been cancelled.` };
  }

  async post(id: string, tenantId: string, userPayload?: any) {
    const journal = await this.findOne(id);
    this.assertDraft(journal);

    if (!journal.lines || journal.lines.length < 2) {
      throw new BadRequestException('A Journal Entry needs at least two lines to post.');
    }

    const totalDebit = journal.lines.reduce((sum, l) => sum + Number(l.debit_amount), 0);
    const totalCredit = journal.lines.reduce((sum, l) => sum + Number(l.credit_amount), 0);

    // Guard against floating-point drift on the equality check.
    if (Math.abs(totalDebit - totalCredit) > 0.0001) {
      throw new BadRequestException(
        `Journal Entry does not balance: total debits (${totalDebit.toFixed(4)}) must equal total credits (${totalCredit.toFixed(4)}).`
      );
    }

    await this.db
      .update(schema.journalHeader)
      .set({
        status: 'POSTED',
        total_debit: totalDebit.toString(),
        total_credit: totalCredit.toString(),
        posted_at: toMysqlTimestamp() as any,
        posted_by: userPayload?.userId || null,
        updated_by: userPayload?.userId || null,
      })
      .where(eq(schema.journalHeader.journal_id, id));

    await this.auditService.log({
      tenantId,
      companyId: journal.company_id,
      userId: userPayload?.userId,
      action: 'POST',
      entityName: 'journal_header',
      entityId: id,
      newValues: { status: 'POSTED' },
    });

    return this.findOne(id);
  }

  // --- System-generated journal entries (e.g. from GL auto-posting) ---
  // Created directly as POSTED: the source movement (an Inventory Ledger entry)
  // is already posted, so its GL mirror doesn't need a separate draft/review step.

  async createAndPostSystemJournal(params: {
    tenantId: string;
    companyId: string;
    postingDate: string;
    sourceDocumentType: string;
    sourceDocumentNo: string;
    sourceLedgerId?: string;
    description?: string;
    lines: SystemJournalLineInput[];
    userId?: string;
  }) {
    return withTenantTransaction(this.cls, async () => {
    const totalDebit = params.lines.reduce((sum, l) => sum + l.debitAmount, 0);
    const totalCredit = params.lines.reduce((sum, l) => sum + l.creditAmount, 0);

    if (Math.abs(totalDebit - totalCredit) > 0.0001) {
      throw new BadRequestException(
        `System journal does not balance: total debits (${totalDebit.toFixed(4)}) must equal total credits (${totalCredit.toFixed(4)}).`
      );
    }

    const journalId = randomUUID();
    const postedTime = toMysqlTimestamp();

    const journalNo = await this.db.transaction(async (tx) => {
      const no = await this.generateJournalNo(params.tenantId, params.companyId, tx);
      await tx.insert(schema.journalHeader).values({
        journal_id: journalId,
        tenant_id: params.tenantId,
        company_id: params.companyId,
        journal_no: no,
        posting_date: params.postingDate,
        source: 'SYSTEM',
        source_document_type: params.sourceDocumentType,
        source_document_no: params.sourceDocumentNo,
        source_ledger_id: params.sourceLedgerId || null,
        description: params.description || null,
        status: 'POSTED',
        total_debit: totalDebit.toString(),
        total_credit: totalCredit.toString(),
        posted_at: postedTime as any,
        posted_by: params.userId || null,
        created_by: params.userId || null,
        updated_by: params.userId || null,
      });
      return no;
    });

    await this.db.insert(schema.journalLine).values(
      params.lines.map((line, idx) => ({
        line_id: randomUUID(),
        journal_id: journalId,
        line_no: idx + 1,
        gl_account_id: line.glAccountId,
        cost_center_id: line.costCenterId || null,
        debit_amount: line.debitAmount.toString(),
        credit_amount: line.creditAmount.toString(),
        description: line.description || null,
        nob_id: line.nobId || null,
        lob_id: line.lobId || null,
      }))
    );

    await this.auditService.log({
      tenantId: params.tenantId,
      companyId: params.companyId,
      userId: params.userId,
      action: 'CREATE',
      entityName: 'journal_header',
      entityId: journalId,
      newValues: { journal_no: journalNo, source: 'SYSTEM', ...params },
    });

    return this.findOne(journalId);
    });
  }
}
