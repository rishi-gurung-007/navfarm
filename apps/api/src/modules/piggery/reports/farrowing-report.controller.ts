import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';
import {
  FarrowingReportFiltersQueryDto,
  FarrowingReportQueryDto,
} from './farrowing-report.dto';
import { FarrowingReportService } from './farrowing-report.service';

@ApiTags('Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('reports')
export class FarrowingReportController {
  constructor(private readonly reportService: FarrowingReportService) {}

  // The report's own farm list: a tenant administrator in the tenant-wide workspace has no company farms in the location
  // master, and a farm login has no Master Data grant, so the picker is read under the report's grant.
  @Get('farrowing/farms')
  @RequirePermission('REPORTS', 'FARROWING', 'view')
  @ApiOperation({ summary: 'Farms the Farrowing Report may offer this caller' })
  async farrowingFarms(@Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.reportService.listFarms(
      tenantId,
      req.user?.userType,
    );
    return { success: true, message: 'Farms retrieved successfully.', data };
  }

  @Get('farrowing/filters')
  @RequirePermission('REPORTS', 'FARROWING', 'view')
  @ApiOperation({
    summary:
      'Farrowing Report pickers — the batches on a farm and the sows recorded in them',
  })
  async farrowingFilters(
    @Query() query: FarrowingReportFiltersQueryDto,
    @Req() req: any,
  ) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.reportService.getFilterOptions(tenantId, query);
    return { success: true, message: 'Farrowing Report filters.', data };
  }

  @Get('farrowing')
  @RequirePermission('REPORTS', 'FARROWING', 'view')
  @ApiOperation({
    summary:
      'R07 Farrowing Report — services, farrowings and litter results per sow batch, with targets and prior year',
  })
  async farrowing(@Query() query: FarrowingReportQueryDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.reportService.getFarrowingReport(tenantId, query);
    return { success: true, message: 'Farrowing Report generated.', data };
  }
}
