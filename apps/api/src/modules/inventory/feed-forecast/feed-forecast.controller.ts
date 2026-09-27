import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FeedForecastService } from './feed-forecast.service';
import { QueryFeedForecastDto, QueryFeedPeriodsDto } from './dto/feed-forecast.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';

// Read-only, and read under the Inventory Ledger permission: the forecast is a
// projection of ledger balances forward in time, so anyone who may see the
// balances may see when they run out — no separate grant to hand out.
@ApiTags('Feed Forecast')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('feed-forecast')
@FarmScoped()
export class FeedForecastController {
  constructor(private readonly feedForecastService: FeedForecastService) {}

  // Read under the same grant as the report (INVENTORY/LEDGER view): a farm
  // login choosing a period has no Master Data grant, and needs none to read
  // the dates its own report is cut by. Declared before @Get() only for
  // readability — 'periods' is a literal path, never taken for a parameter.
  @Get('periods')
  @RequirePermission('INVENTORY', 'LEDGER', 'view')
  @ApiOperation({ summary: "Reporting periods the Feed Forecast's Reporting Period view can use, for one farm's company (D20)" })
  async periods(@Query() query: QueryFeedPeriodsDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.feedForecastService.listPeriods(query.farmId, tenantId, req.user?.userType);
    return { success: true, message: 'Reporting periods retrieved successfully.', data };
  }

  @Get()
  @RequirePermission('INVENTORY', 'LEDGER', 'view')
  @ApiOperation({ summary: "Feed forecast for one farm: each batch's demand, its silo or store, and when that runs down" })
  async get(@Query() query: QueryFeedForecastDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const userType = req.user?.userType;
    const result = await this.feedForecastService.getForecast(query, tenantId, userType);
    return {
      success: true,
      message: 'Feed forecast retrieved successfully.',
      data: result,
    };
  }
}
