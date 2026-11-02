import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';
import { MonthlyOpsQueryDto, MonthlyOpsYearsQueryDto } from './monthly-ops.dto';
import { MonthlyOpsService } from './monthly-ops.service';

@ApiTags('Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('reports')
export class MonthlyOpsController {
  constructor(private readonly report: MonthlyOpsService) {}

  // The report's own farm list, read under its own grant (as R07's is).
  @Get('monthly-ops/farms')
  @RequirePermission('REPORTS', 'MONTHLY_OPS', 'view')
  @ApiOperation({
    summary: 'Farms the Monthly Ops report may offer this caller',
  })
  async farms(@Req() req: any) {
    const data = await this.report.listFarms(
      req.user?.tenantId || req['tenantId'],
      req.user?.userType,
    );
    return { success: true, message: 'Farms retrieved successfully.', data };
  }

  @Get('monthly-ops/years')
  @RequirePermission('REPORTS', 'MONTHLY_OPS', 'view')
  @ApiOperation({
    summary:
      'Fiscal years of the Accounting Period Master, and the current one',
  })
  async years(@Query() query: MonthlyOpsYearsQueryDto, @Req() req: any) {
    const data = await this.report.years(
      req.user?.tenantId || req['tenantId'],
      query.companyId,
    );
    return {
      success: true,
      message: 'Fiscal years retrieved successfully.',
      data,
    };
  }

  @Get('monthly-ops')
  @RequirePermission('REPORTS', 'MONTHLY_OPS', 'view')
  @ApiOperation({
    summary:
      'R12 Monthly Ops — per accounting month and sow breed, for one farm and fiscal year',
  })
  async monthlyOps(@Query() query: MonthlyOpsQueryDto, @Req() req: any) {
    const data = await this.report.getReport(
      req.user?.tenantId || req['tenantId'],
      query,
    );
    return { success: true, message: 'Monthly Ops report generated.', data };
  }
}
