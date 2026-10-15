import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, desc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { withTenantTransaction } from '../../../common/tenant-transaction';
import { JournalService } from '../journal/journal.service';
import { GlPostingService } from '../journal/gl-posting.service';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { CreateExpenseDocumentDto, QueryExpenseDocumentDto, ExpenseDocType } from './dto/expense.dto';

// EXP000123, like the manager's example.
const PREFIX: Record<ExpenseDocType, string> = { EXPENSE_VOUCHER: 'EXV', EXPENSE: 'EXP' };

/**
 * Expense Voucher is recorded and listed only; it never reaches the ledger (Arun, 15 Oct). Expense and Petty Cash post a
 * balanced, already-POSTED journal — Dr expense account, Cr payment account — in the same transaction as the document,
 * so a document never exists without its journal or the other way round.
 */
@Injectable()
export class ExpenseService {
  constructor(
    private readonly cls: ClsService,
    private readonly journalService: JournalService,
    private readonly glPosting: GlPostingService,
    private readonly auditService: AuditLogService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  // Row-locked max+1 per company and document type, like the journal number generator.
  private async nextDocumentNo(companyId: string, docType: ExpenseDocType): Promise<string> {
    const prefix = PREFIX[docType];
    const [row] = await this.db
      .select({ maxSeq: sql<number>`COALESCE(MAX(CAST(SUBSTRING(${schema.expenseDocument.document_no}, 4) AS UNSIGNED)), 0)` })
      .from(schema.expenseDocument)
      .where(and(eq(schema.expenseDocument.company_id, companyId), eq(schema.expenseDocument.doc_type, docType)))
      .for('update');
    return `${prefix}${String(Number(row?.maxSeq || 0) + 1).padStart(6, '0')}`;
  }

  private async assertAccount(companyId: string, accountId: string, label: string) {
    const [acct] = await this.db
      .select({ company_id: schema.glAccountMaster.company_id, is_active: schema.glAccountMaster.is_active, code: schema.glAccountMaster.account_code })
      .from(schema.glAccountMaster)
      .where(eq(schema.glAccountMaster.gl_account_id, accountId))
      .limit(1);
    if (!acct) throw new BadRequestException(`${label} not found.`);
    if (acct.company_id !== companyId) throw new BadRequestException(`${label} '${acct.code}' does not belong to this company.`);
    if (!acct.is_active) throw new BadRequestException(`${label} '${acct.code}' is inactive and cannot be posted to.`);
  }

  // Location is a farm and Sub-Location a shed of that farm, both in this company.
  private async assertLocations(companyId: string, locationId?: string, subLocationId?: string) {
    if (subLocationId && !locationId) throw new BadRequestException('Choose a Location before a Sub-Location.');
    const get = async (id: string) => (await this.db.select().from(schema.locationMaster).where(eq(schema.locationMaster.location_id, id)).limit(1))[0];
    if (locationId) {
      const farm = await get(locationId);
      if (!farm || farm.company_id !== companyId || farm.location_type !== 'FARM') throw new BadRequestException('Location must be a farm of this company.');
    }
    if (subLocationId) {
      const shed = await get(subLocationId);
      if (!shed || shed.company_id !== companyId || shed.location_type !== 'SHED' || shed.parent_location_id !== locationId) {
        throw new BadRequestException('Sub-Location must be a shed of the chosen farm.');
      }
    }
  }

  /** Farms (Location) and their sheds (Sub-Location) for the form's dropdowns. */
  async locations(companyId: string, tenantId: string) {
    const rows = await this.db
      .select({
        location_id: schema.locationMaster.location_id,
        location_code: schema.locationMaster.location_code,
        location_name: schema.locationMaster.location_name,
        location_type: schema.locationMaster.location_type,
        parent_location_id: schema.locationMaster.parent_location_id,
      })
      .from(schema.locationMaster)
      .where(and(
        eq(schema.locationMaster.tenant_id, tenantId),
        eq(schema.locationMaster.company_id, companyId),
        inArray(schema.locationMaster.location_type, ['FARM', 'SHED']),
        eq(schema.locationMaster.is_active, true),
        isNull(schema.locationMaster.deleted_at),
      ))
      .orderBy(schema.locationMaster.location_name);
    return { farms: rows.filter((r) => r.location_type === 'FARM'), sheds: rows.filter((r) => r.location_type === 'SHED') };
  }

  async create(dto: CreateExpenseDocumentDto, tenantId: string, user?: any) {
    const posts = dto.doc_type !== 'EXPENSE_VOUCHER';
    // A voucher may record its Balance Account No. but never posts, so it needs no paid-from account.
    if (dto.expense_gl_account_id) await this.assertAccount(dto.company_id, dto.expense_gl_account_id, 'Balance account');
    if (posts) {
      if (!dto.expense_gl_account_id) throw new BadRequestException('Balance account is required.');
      if (!dto.payment_gl_account_id) throw new BadRequestException('Paid-from account is required.');
      if (dto.expense_gl_account_id === dto.payment_gl_account_id) {
        throw new BadRequestException('Balance account and paid-from account must be different.');
      }
      await this.assertAccount(dto.company_id, dto.payment_gl_account_id, 'Paid-from account');
    }

    await this.assertLocations(dto.company_id, dto.location_id, dto.sub_location_id);
    const costCenterId = posts ? await this.glPosting.resolveFarmCostCentre(dto.sub_location_id ?? dto.location_id) : undefined;

    const expenseId = randomUUID();
    const documentNo = await withTenantTransaction(this.cls, async () => {
      const no = await this.nextDocumentNo(dto.company_id, dto.doc_type);
      let journalId: string | null = null;
      if (posts) {
        // Signed amount: negative is a payment (debit the balance account, credit the paid-from account), positive a receipt.
        const abs = Math.abs(dto.amount);
        const payment = dto.amount < 0;
        const note = dto.remarks || dto.description;
        const journal = await this.journalService.createAndPostSystemJournal({
          tenantId,
          companyId: dto.company_id,
          postingDate: dto.posting_date,
          sourceDocumentType: dto.doc_type,
          sourceDocumentNo: no,
          description: dto.description ? `${no} — ${dto.description}` : no,
          userId: user?.userId,
          lines: [
            { glAccountId: dto.expense_gl_account_id!, costCenterId, debitAmount: payment ? abs : 0, creditAmount: payment ? 0 : abs, description: note },
            { glAccountId: dto.payment_gl_account_id!, costCenterId, debitAmount: payment ? 0 : abs, creditAmount: payment ? abs : 0, description: note },
          ],
        });
        journalId = (journal as any).journal_id;
      }
      await this.db.insert(schema.expenseDocument).values({
        expense_id: expenseId,
        tenant_id: tenantId,
        company_id: dto.company_id,
        doc_type: dto.doc_type,
        document_no: no,
        posting_date: dto.posting_date,
        payee: dto.payee || null,
        description: dto.description || null,
        voucher_type: 'GL',
        balance_account_type: 'GL',
        location_id: dto.location_id || null,
        sub_location_id: dto.sub_location_id || null,
        remarks: dto.remarks || null,
        amount: dto.amount.toFixed(4),
        expense_gl_account_id: dto.expense_gl_account_id || null,
        payment_gl_account_id: posts ? dto.payment_gl_account_id! : null,
        cost_center_id: costCenterId || null,
        journal_id: journalId,
        status: posts ? 'POSTED' : 'RECORDED',
        created_by: user?.userId || null,
      });
      return no;
    });

    await this.auditService.log({
      tenantId,
      companyId: dto.company_id,
      userId: user?.userId,
      action: 'CREATE',
      entityName: 'expense_document',
      entityId: expenseId,
      newValues: { document_no: documentNo, ...dto },
    });
    return this.findOne(expenseId);
  }

  async findAll(query: QueryExpenseDocumentDto, tenantId: string) {
    const conditions: any[] = [eq(schema.expenseDocument.tenant_id, tenantId), isNull(schema.expenseDocument.deleted_at)];
    if (query.doc_type) conditions.push(eq(schema.expenseDocument.doc_type, query.doc_type));
    if (query.companyId) conditions.push(eq(schema.expenseDocument.company_id, query.companyId));
    if (query.search) {
      conditions.push(or(
        like(schema.expenseDocument.document_no, `%${query.search}%`),
        like(schema.expenseDocument.payee, `%${query.search}%`),
      ));
    }
    return this.db
      .select({
        doc: schema.expenseDocument,
        journal_no: schema.journalHeader.journal_no,
      })
      .from(schema.expenseDocument)
      .leftJoin(schema.journalHeader, eq(schema.journalHeader.journal_id, schema.expenseDocument.journal_id))
      .where(and(...conditions))
      .orderBy(desc(schema.expenseDocument.posting_date), desc(schema.expenseDocument.created_at))
      .limit(query.limit || 200)
      .offset(query.offset || 0)
      .then((rows) => rows.map((r) => ({ ...r.doc, journal_no: r.journal_no })));
  }

  async findOne(id: string) {
    const [row] = await this.db
      .select({ doc: schema.expenseDocument, journal_no: schema.journalHeader.journal_no })
      .from(schema.expenseDocument)
      .leftJoin(schema.journalHeader, eq(schema.journalHeader.journal_id, schema.expenseDocument.journal_id))
      .where(and(eq(schema.expenseDocument.expense_id, id), isNull(schema.expenseDocument.deleted_at)))
      .limit(1);
    if (!row) throw new NotFoundException('Document not found.');
    return { ...row.doc, journal_no: row.journal_no };
  }
}
