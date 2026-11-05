/**
 * Gives the demo tenant (devco, company TRIPLEC) the chart of accounts the Fixed Asset sheet names (TDD V1.3, FIXED ASSET tab) and puts those accounts on
 * the biological items, the same plan the project seed uses (sheet-accounts.lib.ts). Read-only by default; --verify writes inside one transaction, reads
 * back and rolls back; --apply commits.
 *
 *   pnpm nx run api:db-apply-sheet-accounts                  # print the plan
 *   pnpm nx run api:db-apply-sheet-accounts -- --verify      # write, read back, roll back
 *   pnpm nx run api:db-apply-sheet-accounts -- --apply       # commit
 *
 * Three things, all through the application's own services:
 *   1. Creates each account the sheet names that the chart does not hold under that name (codes are ours: see sheet-accounts.lib.ts).
 *   2. Sets each item's acquisition, accumulated amortisation, amortisation expense and fair value accounts to the sheet's. The write-off account is left as
 *      it is (the sheet names no impairment account). This is done here and not on the Item Card, which locks the accounts of an item that has posted.
 *   3. Where an amortised item's accumulated amortisation moves from the shared 1065 to its own account, moves what 1065 holds for that item with one posted
 *      journal (Dr 1065 / Cr the item's account), dated today. Without it a death or cull would clear amortisation against an account that never held it.
 *      What 1065 holds for an item is read from the journals of that item's costing runs and its animals' exit journals; nothing else posts there.
 *
 * History is not rewritten: posted journals keep the accounts they were posted to. Reversing a run posted BEFORE this move would debit 1065 again.
 */
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../core/database/schema';
import { withTenantTransaction } from '../common/tenant-transaction';
import { GlAccountService } from '../modules/finance/gl-account/gl-account.service';
import { JournalService } from '../modules/finance/journal/journal.service';
import { EXIT_JOURNAL_TYPE } from '../modules/finance/bio-costing/bio-costing-exit.service';
import { MASTER_CONNECTION } from '../core/database/database.module';
import { ConnectionManagerService } from '../core/database/connection-manager.service';
import * as masterSchema from '../core/database/master-schema';
import { bootApp } from './demo/harness';
import { FIXED_ASSET_ITEMS } from './fixed-asset-items.lib';
import { creditBalance, planSheetAccounts, sheetItemGl, type ItemGl } from './sheet-accounts.lib';

const TENANT_CODE = 'devco';
const COMPANY_CODE = 'TRIPLEC';
const ACTOR_EMAIL = 'company.admin@triplec.local';
const RECLASS_TYPE = 'GL_RECLASS';
const TOL = 0.005;
const GL_COLUMNS: Array<keyof ItemGl> = ['bio_acquisition_gl_id', 'bio_accum_amort_gl_id', 'bio_amort_expense_gl_id', 'bio_fv_gain_loss_gl_id'];

class Rollback extends Error {
  constructor(readonly report: unknown) { super('rolled back'); }
}

async function main() {
  const flags = process.argv.slice(2);
  const mode = flags.find((f) => f === '--verify' || f === '--apply');
  const unknown = flags.filter((f) => f !== mode);
  if (unknown.length) throw new Error('Use --verify, --apply, or no flags.');
  const write = !!mode;
  const today = new Date().toISOString().slice(0, 10);

  const app = await bootApp();
  try {
    // The tenant, company and posting user, resolved by code as the request middleware does (the demo harness's context also wants all nine demo farms).
    const masterDb = app.get<MySql2Database<typeof masterSchema>>(MASTER_CONNECTION);
    const [tenant] = await masterDb.select().from(masterSchema.tenantMaster).where(eq(masterSchema.tenantMaster.tenant_code, TENANT_CODE)).limit(1);
    if (!tenant) throw new Error(`Tenant '${TENANT_CODE}' not found.`);
    const tenantDb = await app.get(ConnectionManagerService).getTenantConnection(tenant);
    const [company] = await tenantDb.select({ company_id: schema.companyMaster.company_id }).from(schema.companyMaster).where(eq(schema.companyMaster.company_code, COMPANY_CODE)).limit(1);
    if (!company) throw new Error(`Company '${COMPANY_CODE}' not found.`);
    const [user] = await tenantDb.select({ user_id: schema.userMaster.user_id, email: schema.userMaster.email }).from(schema.userMaster).where(eq(schema.userMaster.email, ACTOR_EMAIL)).limit(1);
    if (!user) throw new Error(`User '${ACTOR_EMAIL}' not found.`);
    const ctx = { tenantId: tenant.tenant_id, companyId: company.company_id, actor: { userId: user.user_id, userType: 'COMPANY_ADMIN', email: user.email } };
    const cls = app.get(ClsService);
    const accountsService = app.get(GlAccountService);
    const journals = app.get(JournalService);
    const actor = { userId: ctx.actor.userId, userType: ctx.actor.userType, email: ctx.actor.email };

    const report = await cls.run(async () => {
      cls.set('tenantId', ctx.tenantId);
      cls.set('tenantDb', tenantDb);
      try {
        return await withTenantTransaction(cls, async () => {
          const db = cls.get<MySql2Database<typeof schema>>('tenantDb')!;
          const G = schema.glAccountMaster;
          const I = schema.itemMaster;
          const readChart = () => db.select().from(G).where(and(eq(G.company_id, ctx.companyId), isNull(G.deleted_at)));

          // ---- 1. accounts -----------------------------------------------------------------------------------------------------------
          let chart = await readChart();
          const anchor = chart.find((a) => a.account_code === '1050');
          if (!anchor) throw new Error('The chart has no account 1050 to take the NOB and LOB from.');
          const accountPlan = planSheetAccounts(chart);
          if (write) {
            for (const a of accountPlan.filter((p) => p.action === 'CREATE')) {
              await accountsService.create({ company_id: ctx.companyId, account_code: a.code, account_name: a.name, account_type: a.account_type, nob_id: anchor.nob_id, lob_id: anchor.lob_id } as any, ctx.tenantId, actor);
            }
            chart = await readChart();
          }
          const idOf = (name: string | null) => {
            if (!name) return null;
            const found = chart.find((a) => a.account_name.trim().toLowerCase() === name.trim().toLowerCase());
            if (found) return found.gl_account_id;
            const planned = accountPlan.find((p) => p.name === name);
            return planned ? `new:${planned.code}` : null;
          };
          const codeOf = (id: string | null) => (id == null ? null : id.startsWith('new:') ? id.slice(4) : chart.find((a) => a.gl_account_id === id)?.account_code ?? id);

          // ---- 2. items, and 3. what 1065 holds for each ---------------------------------------------------------------------------------
          const rows = await db.select().from(I).where(and(eq(I.company_id, ctx.companyId), isNull(I.deleted_at)));
          const itemReport: unknown[] = [];
          const reclass: Array<{ item: string; from: string | null; to: string | null; amount: number; journal_no?: string }> = [];
          const missing: string[] = [];
          for (const c of FIXED_ASSET_ITEMS) {
            const matches = rows.filter((r) => r.item_code.toLowerCase() === c.item_code.toLowerCase());
            if (!matches.length) { missing.push(c.item_code); continue; }
            const desired = sheetItemGl(c, idOf);
            for (const row of matches) {
              const changes = GL_COLUMNS.filter((col) => (row[col] ?? null) !== desired[col]);
              itemReport.push({
                item: row.item_code,
                changes: Object.fromEntries(changes.map((col) => [col, { from: codeOf(row[col] ?? null), to: codeOf(desired[col]) }])),
              });
              const oldAccum = row.bio_accum_amort_gl_id;
              const newAccum = desired.bio_accum_amort_gl_id;
              if (c.costing_method === 'AMORTIZATION' && oldAccum && newAccum && oldAccum !== newAccum) {
                const runNos = (await db.select({ no: schema.bioCostingRun.run_no }).from(schema.bioCostingRun).where(eq(schema.bioCostingRun.item_id, row.item_id))).map((r) => r.no);
                const animalCodes = (await db.select({ code: schema.animalRegister.animal_code }).from(schema.animalRegister).where(eq(schema.animalRegister.item_id, row.item_id))).map((r) => r.code);
                const J = schema.journalHeader;
                const L = schema.journalLine;
                const sources = [
                  ...(runNos.length ? [and(eq(J.source_document_type, 'BIO_COSTING_RUN'), inArray(J.source_document_no, runNos))!] : []),
                  ...(animalCodes.length ? [and(eq(J.source_document_type, EXIT_JOURNAL_TYPE), inArray(J.source_document_no, animalCodes))!] : []),
                ];
                const lines = sources.length
                  ? await db.select({ debit_amount: L.debit_amount, credit_amount: L.credit_amount }).from(L).innerJoin(J, eq(J.journal_id, L.journal_id))
                      .where(and(eq(L.gl_account_id, oldAccum), eq(J.company_id, ctx.companyId), eq(J.status, 'POSTED'), isNull(J.deleted_at), or(...sources)))
                  : [];
                const amount = creditBalance(lines);
                const entry: (typeof reclass)[number] = { item: row.item_code, from: codeOf(oldAccum), to: codeOf(newAccum), amount };
                if (write && amount >= TOL) {
                  const posted = (await journals.createAndPostSystemJournal({
                    tenantId: ctx.tenantId, companyId: ctx.companyId, postingDate: today, sourceDocumentType: RECLASS_TYPE, sourceDocumentNo: row.item_code,
                    description: `Accumulated amortisation of ${row.item_code} moved to its own account (TDD V1.3 Fixed Asset sheet)`, userId: ctx.actor.userId,
                    lines: [
                      { glAccountId: oldAccum, debitAmount: amount, creditAmount: 0, nobId: row.nob_id ?? undefined, lobId: row.lob_id ?? undefined, description: `${row.item_code} accumulated amortisation out of ${entry.from}` },
                      { glAccountId: newAccum, debitAmount: 0, creditAmount: amount, nobId: row.nob_id ?? undefined, lobId: row.lob_id ?? undefined, description: `${row.item_code} accumulated amortisation into ${entry.to}` },
                    ],
                  })) as { journal_no: string };
                  entry.journal_no = posted.journal_no;
                }
                reclass.push(entry);
              }
              if (write && changes.length) {
                await db.update(I).set(Object.fromEntries(changes.map((col) => [col, desired[col]]))).where(eq(I.item_id, row.item_id));
              }
            }
          }

          // ---- read back ---------------------------------------------------------------------------------------------------------------
          const balanceOf = async (code: string) => {
            const [r] = await db.select({ x: sql<string>`COALESCE(SUM(${schema.journalLine.credit_amount} - ${schema.journalLine.debit_amount}), 0)` })
              .from(schema.journalLine).innerJoin(G, eq(G.gl_account_id, schema.journalLine.gl_account_id))
              .where(and(eq(G.company_id, ctx.companyId), eq(G.account_code, code)));
            return Math.round(Number(r?.x ?? 0) * 100) / 100;
          };
          const after = write ? await db.select().from(I).where(and(eq(I.company_id, ctx.companyId), isNull(I.deleted_at))) : [];
          const notAsPlanned = after.flatMap((row) => {
            const c = FIXED_ASSET_ITEMS.find((x) => x.item_code.toLowerCase() === row.item_code.toLowerCase());
            if (!c) return [];
            const desired = sheetItemGl(c, idOf);
            return GL_COLUMNS.filter((col) => (row[col] ?? null) !== desired[col]).map((col) => `${row.item_code}.${col}`);
          });
          const accumulatedBalances = write
            ? Object.fromEntries(await Promise.all(accountPlan.filter((p) => p.kind === 'accumulated').map(async (p) => [`${p.code} ${p.name}`, await balanceOf(p.code)] as const)))
            : undefined;

          const out = {
            mode: mode ?? 'plan only (nothing written)',
            accounts: accountPlan.map((p) => ({ code: p.code, name: p.name, type: p.account_type, action: p.action })),
            items: itemReport,
            items_not_created: missing,
            accumulated_amortisation_moved: reclass,
            ...(write ? {
              read_back: {
                item_columns_not_as_planned: notAsPlanned,
                balance_left_on_1065: await balanceOf('1065'),
                accumulated_amortisation_accounts: accumulatedBalances,
              },
            } : {}),
          };
          if (mode !== '--apply') throw new Rollback(out);
          return out;
        });
      } catch (e) {
        if (e instanceof Rollback) return { ...(e.report as object), rolled_back: write };
        throw e;
      }
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await app.close();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
