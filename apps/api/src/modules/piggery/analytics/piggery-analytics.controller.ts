import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';
import { PiggeryAnalyticsService } from './piggery-analytics.service';
import type { QueryPiggeryGmDashboardDto } from './piggery-analytics.dto';

@ApiTags('Piggery GM Dashboard & Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('piggery/analytics')
export class PiggeryAnalyticsController {
  constructor(private readonly analyticsService: PiggeryAnalyticsService) {}

  @Get('gm-dashboard')
  @RequirePermission('PIGGERY', 'ANIMAL', 'view')
  @ApiOperation({ summary: 'Get Piggery GM Executive Dashboard telemetry, reproductive metrics, and farm scorecard' })
  async getGmDashboard(
    @Req() req: any,
    @Query() query: QueryPiggeryGmDashboardDto,
  ) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    return await this.analyticsService.getGmDashboard(tenantId, query);
  }
}
