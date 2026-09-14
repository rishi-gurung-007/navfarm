import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FinancialReportsService } from './financial-reports.service';
import { TrialBalanceQueryDto, BalanceSheetQueryDto, ProfitLossQueryDto, BioAssetRollForwardQueryDto, HerdAnalyticsQueryDto, BatchCostVarianceQueryDto } from './dto/financial-reports.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';

// C3: a Grasmere standard user got 0 rows from /animal but the whole
// company's herd from herd-analytics — this controller was never marked,
// so its service trusted the query companyId outright. @FarmScoped() puts
// it on the coverage ratchet's SCOPED list; the per-report scoping itself
// lives in the service (company derivation, and animal/batch scope
// conditions on the reports that aggregate farm-specific records).
@ApiTags('Financial Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('financial-reports')
export class FinancialReportsController {
  constructor(private readonly reportsService: FinancialReportsService) {}

  @Get('trial-balance')
  @RequirePermission('FINANCE', 'REPORTS', 'view')
  @ApiOperation({ summary: 'Trial Balance — debit/credit totals per GL account as of a date' })
  async trialBalance(@Query() query: TrialBalanceQueryDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.reportsService.getTrialBalance(tenantId, query.companyId, query.asOfDate);
    return { success: true, message: 'Trial Balance retrieved successfully.', data: result };
  }

  @Get('balance-sheet')
  @RequirePermission('FINANCE', 'REPORTS', 'view')
  @ApiOperation({ summary: 'Balance Sheet — Assets/Liabilities/Equity as of a date' })
  async balanceSheet(@Query() query: BalanceSheetQueryDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.reportsService.getBalanceSheet(tenantId, query.companyId, query.asOfDate);
    return { success: true, message: 'Balance Sheet retrieved successfully.', data: result };
  }

  @Get('profit-loss')
  @RequirePermission('FINANCE', 'REPORTS', 'view')
  @ApiOperation({ summary: 'Profit & Loss — Income/Expense for a date range' })
  async profitLoss(@Query() query: ProfitLossQueryDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.reportsService.getProfitLoss(tenantId, query.companyId, query.dateFrom, query.dateTo);
    return { success: true, message: 'Profit & Loss retrieved successfully.', data: result };
  }

  @Get('bio-asset-roll-forward')
  @RequirePermission('FINANCE', 'REPORTS', 'view')
  @ApiOperation({ summary: 'IAS 41 Biological Asset Roll-Forward — carrying amount reconciliation' })
  async bioAssetRollForward(@Query() query: BioAssetRollForwardQueryDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.reportsService.getBiologicalAssetRollForward(tenantId, query.companyId, query.dateFrom, query.dateTo);
    return { success: true, message: 'Biological Asset Roll-Forward statement retrieved.', data: result };
  }

  @Get('herd-analytics')
  @RequirePermission('PIGGERY', 'ANIMAL', 'view')
  @ApiOperation({ summary: 'Piggery Herd Analytics — headcount, parity profile, and productivity' })
  async herdAnalytics(@Query() query: HerdAnalyticsQueryDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.reportsService.getPiggeryHerdAnalytics(tenantId, query.companyId, query.batchId);
    return { success: true, message: 'Piggery Herd Analytics retrieved.', data: result };
  }

  @Get('batch-cost-variance')
  @RequirePermission('FINANCE', 'REPORTS', 'view')
  @ApiOperation({ summary: 'Batch Cost Variance Report — standard vs actual variance breakdown' })
  async batchCostVariance(@Query() query: BatchCostVarianceQueryDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.reportsService.getBatchCostVarianceReport(tenantId, query.companyId, query.batchId);
    return { success: true, message: 'Batch Cost Variance report retrieved.', data: result };
  }
}

