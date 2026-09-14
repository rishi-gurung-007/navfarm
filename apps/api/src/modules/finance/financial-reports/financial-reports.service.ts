import { ForbiddenException, Injectable } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, lte, between, isNull, sql, inArray, or } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { animalOnFarm, animalScopeConditions, batchOnFarm, batchScopeConditions, farmScope, FarmScope } from '../../../common/farm-scope';

interface AccountBalanceRow {
  gl_account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  parent_account_id: string | null;
  total_debit: number;
  total_credit: number;
}

// Normal-balance convention: ASSET/EXPENSE accounts increase with debits;
// LIABILITY/EQUITY/INCOME accounts increase with credits. Not stored on the
// account itself — derived from account_type, matching gl_account_master's
// existing ASSET/LIABILITY/EQUITY/INCOME/EXPENSE enum.
const DEBIT_NORMAL_TYPES = new Set(['ASSET', 'EXPENSE']);

function netBalance(row: AccountBalanceRow): number {
  return DEBIT_NORMAL_TYPES.has(row.account_type) ? row.total_debit - row.total_credit : row.total_credit - row.total_debit;
}

@Injectable()
export class FinancialReportsService {
  constructor(private readonly cls: ClsService) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  /**
   * Every report is company-bound. A caller whose scope already names a
   * company (company admin, operational admin, standard user) must query
   * that company — the client-supplied companyId is only trusted when the
   * scope has none, which is true only for tenant/system admins who have
   * not selected one. This is what closes C3: the herd-analytics endpoint
   * used to trust the query companyId outright.
   */
  private resolveCompanyId(scope: FarmScope, queryCompanyId: string): string {
    if (scope.companyId) {
      if (queryCompanyId && queryCompanyId !== scope.companyId) {
        throw new ForbiddenException('Report company must match the workspace.');
      }
      return scope.companyId;
    }
    return queryCompanyId;
  }

  private async getAccountBalances(
    tenantId: string,
    companyId: string,
    dateCondition: any,
    accountTypes?: string[],
    lobId?: string,
  ): Promise<AccountBalanceRow[]> {
    const conditions: any[] = [
      eq(schema.journalHeader.tenant_id, tenantId),
      eq(schema.journalHeader.company_id, companyId),
      eq(schema.journalHeader.status, 'POSTED'),
      isNull(schema.journalHeader.deleted_at),
      dateCondition,
    ];
    if (accountTypes && accountTypes.length > 0) {
      conditions.push(inArray(schema.glAccountMaster.account_type, accountTypes));
    }
    if (lobId) {
      conditions.push(eq(schema.journalLine.lob_id, lobId));
    }

    const rows = await this.db
      .select({
        gl_account_id: schema.journalLine.gl_account_id,
        account_code: schema.glAccountMaster.account_code,
        account_name: schema.glAccountMaster.account_name,
        account_type: schema.glAccountMaster.account_type,
        parent_account_id: schema.glAccountMaster.parent_account_id,
        total_debit: sql<string>`COALESCE(SUM(${schema.journalLine.debit_amount}), 0)`,
        total_credit: sql<string>`COALESCE(SUM(${schema.journalLine.credit_amount}), 0)`,
      })
      .from(schema.journalLine)
      .innerJoin(schema.journalHeader, eq(schema.journalLine.journal_id, schema.journalHeader.journal_id))
      .innerJoin(schema.glAccountMaster, eq(schema.journalLine.gl_account_id, schema.glAccountMaster.gl_account_id))
      .where(and(...conditions))
      .groupBy(
        schema.journalLine.gl_account_id,
        schema.glAccountMaster.account_code,
        schema.glAccountMaster.account_name,
        schema.glAccountMaster.account_type,
        schema.glAccountMaster.parent_account_id
      );

    return rows.map((r) => ({ ...r, total_debit: Number(r.total_debit), total_credit: Number(r.total_credit) }));
  }

  async getTrialBalance(tenantId: string, queryCompanyId: string, asOfDate: string) {
    // Finance statements are company-level, not farm-scoped (decided
    // 2026-09-14) — but the company itself must still come from scope, not
    // an unchecked client-supplied id.
    const companyId = this.resolveCompanyId(farmScope(this.cls), queryCompanyId);
    const rows = await this.getAccountBalances(tenantId, companyId, lte(schema.journalHeader.posting_date, asOfDate));

    const accounts = rows
      .map((r) => ({
        gl_account_id: r.gl_account_id,
        account_code: r.account_code,
        account_name: r.account_name,
        account_type: r.account_type,
        total_debit: r.total_debit,
        total_credit: r.total_credit,
      }))
      .sort((a, b) => a.account_code.localeCompare(b.account_code));

    const totalDebit = accounts.reduce((sum, a) => sum + a.total_debit, 0);
    const totalCredit = accounts.reduce((sum, a) => sum + a.total_credit, 0);

    return { asOfDate, accounts, totalDebit, totalCredit, isBalanced: Math.abs(totalDebit - totalCredit) < 0.0001 };
  }

  async getBalanceSheet(tenantId: string, queryCompanyId: string, asOfDate: string) {
    const companyId = this.resolveCompanyId(farmScope(this.cls), queryCompanyId);
    const rows = await this.getAccountBalances(tenantId, companyId, lte(schema.journalHeader.posting_date, asOfDate), [
      'ASSET',
      'LIABILITY',
      'EQUITY',
    ]);

    const toLine = (r: AccountBalanceRow) => ({
      gl_account_id: r.gl_account_id,
      account_code: r.account_code,
      account_name: r.account_name,
      balance: netBalance(r),
    });

    const assets = rows.filter((r) => r.account_type === 'ASSET').map(toLine).sort((a, b) => a.account_code.localeCompare(b.account_code));
    const liabilities = rows.filter((r) => r.account_type === 'LIABILITY').map(toLine).sort((a, b) => a.account_code.localeCompare(b.account_code));
    const equity = rows.filter((r) => r.account_type === 'EQUITY').map(toLine).sort((a, b) => a.account_code.localeCompare(b.account_code));

    // There's no period-close step anywhere in this system (no journal entry
    // ever zeroes Income/Expense into a retained-earnings GL account), so an
    // interim balance sheet has nowhere for the period's trading result to
    // land — Assets would never equal Liabilities + Equity for any company
    // with real revenue/expense activity. Computed on the fly (all posted
    // Income/Expense activity from inception through asOfDate, same
    // convention as the Asset/Liability/Equity pull above) and shown as one
    // synthetic Equity line, rather than requiring a formal closing entry.
    const plRows = await this.getAccountBalances(tenantId, companyId, lte(schema.journalHeader.posting_date, asOfDate), [
      'INCOME',
      'EXPENSE',
    ]);
    const totalIncome = plRows.filter((r) => r.account_type === 'INCOME').reduce((sum, r) => sum + netBalance(r), 0);
    const totalExpense = plRows.filter((r) => r.account_type === 'EXPENSE').reduce((sum, r) => sum + netBalance(r), 0);
    const retainedEarnings = totalIncome - totalExpense;

    if (Math.abs(retainedEarnings) > 0.0001) {
      equity.push({
        gl_account_id: 'retained-earnings-current-period',
        account_code: 'RE-CURRENT',
        account_name: 'Retained Earnings (Current Period)',
        balance: retainedEarnings,
      });
    }

    const totalAssets = assets.reduce((sum, a) => sum + a.balance, 0);
    const totalLiabilities = liabilities.reduce((sum, a) => sum + a.balance, 0);
    const totalEquity = equity.reduce((sum, a) => sum + a.balance, 0);

    return {
      asOfDate,
      assets,
      liabilities,
      equity,
      totalAssets,
      totalLiabilities,
      totalEquity,
      totalLiabilitiesAndEquity: totalLiabilities + totalEquity,
      isBalanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.0001,
    };
  }

  async getProfitLoss(tenantId: string, queryCompanyId: string, dateFrom: string, dateTo: string) {
    const companyId = this.resolveCompanyId(farmScope(this.cls), queryCompanyId);
    const rows = await this.getAccountBalances(
      tenantId,
      companyId,
      between(schema.journalHeader.posting_date, dateFrom, dateTo),
      ['INCOME', 'EXPENSE']
    );

    const toLine = (r: AccountBalanceRow) => ({
      gl_account_id: r.gl_account_id,
      account_code: r.account_code,
      account_name: r.account_name,
      balance: netBalance(r),
    });

    const income = rows.filter((r) => r.account_type === 'INCOME').map(toLine).sort((a, b) => a.account_code.localeCompare(b.account_code));
    const expense = rows.filter((r) => r.account_type === 'EXPENSE').map(toLine).sort((a, b) => a.account_code.localeCompare(b.account_code));

    const totalIncome = income.reduce((sum, a) => sum + a.balance, 0);
    const totalExpense = expense.reduce((sum, a) => sum + a.balance, 0);

    return { dateFrom, dateTo, income, expense, totalIncome, totalExpense, netIncome: totalIncome - totalExpense };
  }

  async getBiologicalAssetRollForward(tenantId: string, queryCompanyId: string, dateFrom: string, dateTo: string) {
    const scope = farmScope(this.cls);
    const companyId = this.resolveCompanyId(scope, queryCompanyId);

    const conditions = [
      eq(schema.bioAssetLedger.tenant_id, tenantId),
      eq(schema.bioAssetLedger.company_id, companyId),
      lte(schema.bioAssetLedger.posting_date, dateTo),
    ];
    // A farm is not an operational-area boundary. Two LOBs can post against
    // the same farm, so the farm predicate below cannot substitute for this
    // exact ledger dimension.
    if (scope.lobId) {
      conditions.push(eq(schema.bioAssetLedger.lob_id, scope.lobId));
    }
    // bio_asset_ledger carries no farm_id of its own — its farm comes from
    // the batch or animal the entry is against, same as bio-asset-ledger.service.
    if (scope.farmId) {
      conditions.push(
        or(
          batchOnFarm(schema.bioAssetLedger.batch_id, scope.farmId),
          animalOnFarm(schema.bioAssetLedger.animal_id, scope.farmId),
        )!,
      );
    }

    const allEntries = await this.db
      .select({
        entry_id: schema.bioAssetLedger.entry_id,
        entry_type: schema.bioAssetLedger.entry_type,
        posting_date: schema.bioAssetLedger.posting_date,
        cost_amount: schema.bioAssetLedger.cost_amount,
        quantity: schema.bioAssetLedger.quantity,
        batch_id: schema.bioAssetLedger.batch_id,
        animal_id: schema.bioAssetLedger.animal_id,
        stage: schema.bioAssetLedger.stage,
        costing_method: schema.bioAssetLedger.costing_method,
      })
      .from(schema.bioAssetLedger)
      .where(and(...conditions))
      .orderBy(schema.bioAssetLedger.posting_date);

    let openingCarryingValue = 0;
    let acquisitions = 0;
    let growthCapitalization = 0;
    let amortization = 0;
    let fairValueAdjustments = 0;
    let harvestTransfers = 0;
    let disposals = 0;
    let periodMovements = 0;

    let batchCarryingValue = 0;
    let animalCarryingValue = 0;

    const periodTransactions: any[] = [];

    for (const e of allEntries) {
      const amount = Number(e.cost_amount) || 0;
      const isPrior = e.posting_date < dateFrom;

      if (isPrior) {
        openingCarryingValue += amount;
      } else {
        periodMovements += amount;
        periodTransactions.push(e);

        switch (e.entry_type) {
          case 'ACQUISITION':
            acquisitions += amount;
            break;
          case 'CONSUMPTION':
          case 'OVERHEAD':
          case 'OVERHEAD_COST':
          case 'GROWTH_ADJMT':
            growthCapitalization += amount;
            break;
          case 'AMORTIZATION':
            amortization += amount;
            break;
          case 'FAIR_VALUE_ADJMT':
            fairValueAdjustments += amount;
            break;
          case 'TRANSFORMATION':
            harvestTransfers += amount;
            break;
          case 'WRITEOFF':
          case 'MORTALITY':
          case 'DEAD_PLANT':
            disposals += amount;
            break;
          default:
            if (amount > 0) acquisitions += amount;
            else disposals += amount;
            break;
        }
      }

      if (e.animal_id) {
        animalCarryingValue += amount;
      } else {
        batchCarryingValue += amount;
      }
    }

    const closingCarryingValue = openingCarryingValue + periodMovements;

    // journal_line carries LOB but neither it nor journal_header carries a
    // farm. A farm-filtered ledger therefore has no dimension-equivalent GL
    // total. Reporting a company/LOB-wide GL number beside it as a variance is
    // actively misleading, so mark reconciliation unavailable in that case.
    // Without a selected farm, both sides can be constrained to the same
    // company and (for operational users) exact LOB.
    let glReconciliation;
    if (scope.farmId) {
      glReconciliation = {
        available: false,
        status: 'UNAVAILABLE' as const,
        reason: 'GL journal lines do not carry a farm dimension.',
        glAccounts: [],
        totalGlBalance: null,
        variance: null,
        isReconciled: false,
      };
    } else {
      const glRows = await this.getAccountBalances(
        tenantId,
        companyId,
        lte(schema.journalHeader.posting_date, dateTo),
        ['ASSET'],
        scope.lobId ?? undefined,
      );

      const bioGlAccounts = glRows.filter((r) =>
        r.account_code.startsWith('1050') ||
        r.account_code.startsWith('1060') ||
        r.account_name.toLowerCase().includes('biological asset')
      );

      const totalGlBalance = bioGlAccounts.reduce((sum, r) => sum + netBalance(r), 0);
      const variance = closingCarryingValue - totalGlBalance;
      glReconciliation = {
        available: true,
        status: 'AVAILABLE' as const,
        reason: null,
        glAccounts: bioGlAccounts.map((a) => ({
          account_code: a.account_code,
          account_name: a.account_name,
          balance: netBalance(a),
        })),
        totalGlBalance,
        variance,
        isReconciled: Math.abs(variance) < 0.01,
      };
    }

    return {
      dateFrom,
      dateTo,
      openingCarryingValue,
      movements: {
        acquisitions,
        growthCapitalization,
        amortization,
        fairValueAdjustments,
        harvestTransfers,
        disposals,
        netMovement: periodMovements,
      },
      closingCarryingValue,
      assetTypeBreakdown: {
        batchCarryingValue,
        animalCarryingValue,
      },
      glReconciliation,
      transactionCount: periodTransactions.length,
    };
  }

  async getPiggeryHerdAnalytics(tenantId: string, queryCompanyId: string, batchId?: string) {
    const scope = farmScope(this.cls);
    const companyId = this.resolveCompanyId(scope, queryCompanyId);

    // animalScopeConditions carries the farm/company/LOB boundary for
    // animal_register itself — this is what C3 found missing: a restricted
    // or farm-selected caller must see only their farm's herd here, exactly
    // as /animal already does.
    const conditions = [
      eq(schema.animalRegister.tenant_id, tenantId),
      eq(schema.animalRegister.company_id, companyId),
      ...animalScopeConditions(scope),
    ];
    if (batchId) conditions.push(eq(schema.animalRegister.current_batch_id, batchId));

    const animals = await this.db
      .select({
        animal: schema.animalRegister,
        breed: schema.breedMaster,
        stage: schema.stageMaster,
      })
      .from(schema.animalRegister)
      .leftJoin(schema.breedMaster, eq(schema.animalRegister.breed_id, schema.breedMaster.breed_id))
      .leftJoin(schema.stageMaster, eq(schema.animalRegister.current_stage_id, schema.stageMaster.stage_id))
      .where(and(...conditions));

    const activeAnimals = animals.filter((a) => a.animal.is_active);
    const disposedAnimals = animals.filter((a) => !a.animal.is_active);

    const totalHeadcount = activeAnimals.length;
    const totalBookValue = activeAnimals.reduce(
      (sum, a) => sum + (Number(a.animal.book_value) || Number(a.animal.total_opening_asset_value) || 0),
      0
    );

    const genderCounts: Record<string, number> = { Female: 0, Male: 0 };
    for (const a of activeAnimals) {
      if (a.animal.gender === 'F') genderCounts.Female++;
      else if (a.animal.gender === 'M') genderCounts.Male++;
    }

    const typeCounts: Record<string, number> = {};
    for (const a of activeAnimals) {
      const type = a.animal.animal_type || 'UNKNOWN';
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    }

    const stageCounts: Record<string, { stage_name: string; count: number }> = {};
    for (const a of activeAnimals) {
      const stageKey = a.animal.current_stage_id || 'UNASSIGNED';
      const stageName = a.stage?.stage_name || a.animal.current_stage_id || 'Unassigned';
      if (!stageCounts[stageKey]) {
        stageCounts[stageKey] = { stage_name: stageName, count: 0 };
      }
      stageCounts[stageKey].count++;
    }

    const breedCounts: Record<string, { breed_name: string; count: number }> = {};
    for (const a of activeAnimals) {
      const breedKey = a.animal.breed_id;
      const breedName = a.breed?.breed_name || 'Unknown Breed';
      if (!breedCounts[breedKey]) {
        breedCounts[breedKey] = { breed_name: breedName, count: 0 };
      }
      breedCounts[breedKey].count++;
    }

    const parityCurve: Record<string, number> = {
      'Parity 0 (Gilt)': 0,
      'Parity 1': 0,
      'Parity 2': 0,
      'Parity 3': 0,
      'Parity 4': 0,
      'Parity 5': 0,
      'Parity 6+': 0,
    };

    for (const a of activeAnimals) {
      if (a.animal.gender === 'F') {
        const p = a.animal.parity_count || 0;
        if (p === 0) parityCurve['Parity 0 (Gilt)']++;
        else if (p === 1) parityCurve['Parity 1']++;
        else if (p === 2) parityCurve['Parity 2']++;
        else if (p === 3) parityCurve['Parity 3']++;
        else if (p === 4) parityCurve['Parity 4']++;
        else if (p === 5) parityCurve['Parity 5']++;
        else parityCurve['Parity 6+']++;
      }
    }

    const totalPigletsBornLive = animals.reduce((sum, a) => sum + (a.animal.total_piglets_born_live || 0), 0);
    const totalPigletsWeaned = animals.reduce((sum, a) => sum + (a.animal.total_piglets_weaned || 0), 0);
    const weaningRate = totalPigletsBornLive > 0 ? (totalPigletsWeaned / totalPigletsBornLive) * 100 : 0;

    const disposalBreakdown: Record<string, number> = {};
    let totalGainLoss = 0;
    for (const a of disposedAnimals) {
      const dtype = a.animal.disposal_type || 'OTHER';
      disposalBreakdown[dtype] = (disposalBreakdown[dtype] || 0) + 1;
      totalGainLoss += Number(a.animal.gain_loss_on_disposal) || 0;
    }

    return {
      totalHeadcount,
      totalBookValue,
      genderBreakdown: genderCounts,
      typeBreakdown: typeCounts,
      stageBreakdown: Object.values(stageCounts),
      breedBreakdown: Object.values(breedCounts),
      parityDistribution: parityCurve,
      productivity: {
        totalPigletsBornLive,
        totalPigletsWeaned,
        weaningRate: Number(weaningRate.toFixed(2)),
      },
      disposals: {
        totalDisposed: disposedAnimals.length,
        disposalBreakdown,
        totalGainLoss,
      },
    };
  }

  async getBatchCostVarianceReport(tenantId: string, queryCompanyId: string, batchId?: string) {
    const scope = farmScope(this.cls);
    const companyId = this.resolveCompanyId(scope, queryCompanyId);

    // batch_cost_variance has no tenant_id/company_id of its own — those
    // live on the batch it belongs to, so scoping goes through the join.
    // It's also one row per (batch, item, variance_type PRICE/USAGE/OUTPUT/
    // OVERHEAD), not one row per batch — this pivots those rows into a
    // single per-batch summary, which is the shape this report presents.
    // batchScopeConditions carries the farm/company/LOB boundary on
    // batch_header itself, same as every other batch-scoped read.
    const conditions: any[] = [
      eq(schema.batchHeader.tenant_id, tenantId),
      eq(schema.batchHeader.company_id, companyId),
      ...batchScopeConditions(scope),
    ];
    if (batchId) {
      conditions.push(eq(schema.batchCostVariance.batch_id, batchId));
    }

    const rows = await this.db
      .select({
        variance: schema.batchCostVariance,
        batch: schema.batchHeader,
      })
      .from(schema.batchCostVariance)
      .innerJoin(schema.batchHeader, eq(schema.batchCostVariance.batch_id, schema.batchHeader.batch_id))
      .where(and(...conditions))
      .orderBy(schema.batchCostVariance.created_at);

    const byBatch = new Map<string, {
      batch: typeof schema.batchHeader.$inferSelect;
      priceVariance: number;
      usageVariance: number;
      outputVariance: number;
      overheadVariance: number;
      totalVariance: number;
      lastRecordedAt: string;
    }>();

    for (const { variance, batch } of rows) {
      let entry = byBatch.get(batch.batch_id);
      if (!entry) {
        entry = {
          batch,
          priceVariance: 0,
          usageVariance: 0,
          outputVariance: 0,
          overheadVariance: 0,
          totalVariance: 0,
          lastRecordedAt: variance.created_at,
        };
        byBatch.set(batch.batch_id, entry);
      }

      // std_value / actual_value are NOT money on every row — PRICE holds a
      // rate, USAGE a quantity, OUTPUT a head count, OVERHEAD an amount. Only
      // variance_amount is currency on all four, so the cost columns are
      // derived from the batch's own accumulated cost below instead of summed
      // from these mixed units.
      const amount = Number(variance.variance_amount) || 0;
      entry.totalVariance += amount;
      if (variance.created_at > entry.lastRecordedAt) entry.lastRecordedAt = variance.created_at;

      switch (variance.variance_type) {
        case 'PRICE': entry.priceVariance += amount; break;
        case 'USAGE': entry.usageVariance += amount; break;
        case 'OUTPUT': entry.outputVariance += amount; break;
        case 'OVERHEAD': entry.overheadVariance += amount; break;
      }
    }

    return Array.from(byBatch.values()).map((entry) => {
      // close() guarantees actual cost = standard output value + variances, so
      // the standard cost is the actual cost net of what the variances explain.
      const actualCost = Number(entry.batch.total_cost) || 0;
      const standardCost = actualCost - entry.totalVariance;
      const pct = standardCost > 0 ? (entry.totalVariance / standardCost) * 100 : 0;

      return {
        batch_id: entry.batch.batch_id,
        batch_no: entry.batch.batch_no,
        costing_method: entry.batch.costing_method,
        recorded_at: entry.lastRecordedAt,
        standard_cost: standardCost,
        actual_cost: actualCost,
        price_variance: entry.priceVariance,
        usage_variance: entry.usageVariance,
        output_variance: entry.outputVariance,
        overhead_variance: entry.overheadVariance,
        total_variance: entry.totalVariance,
        variance_pct: Number(pct.toFixed(2)),
        is_favorable: entry.totalVariance <= 0,
      };
    });
  }
}
