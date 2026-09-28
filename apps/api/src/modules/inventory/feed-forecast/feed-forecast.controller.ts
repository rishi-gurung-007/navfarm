import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FeedForecastService } from './feed-forecast.service';
import { QueryFeedForecastDto, QueryFeedPeriodsDto, UpdateFeedFarmSettingsDto } from './dto/feed-forecast.dto';
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

  // Read under the report's own grant for the same reason as 'periods': a farm
  // login has no Master Data grant, and the farm picker is part of the report.
  @Get('farms')
  @RequirePermission('INVENTORY', 'LEDGER', 'view')
  @ApiOperation({ summary: 'Farms the feed screens may offer this caller, by the same rules the report applies (review A2)' })
  async farms(@Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.feedForecastService.listFarms(tenantId, req.user?.userType);
    return { success: true, message: 'Farms retrieved successfully.', data };
  }

  /**
   * D32: the six per-farm feed settings, read and written on their own screen
   * (Settings → Inventory Setup → Feed Planning) instead of on the Add/Edit
   * Location form. Read under the report's grant, like 'farms' above, so the
   * table renders for anyone who may see the forecast the settings shape.
   * Written under the location master's own edit right, because the row being
   * changed is a farm's master row. Deliberately not the generic
   * PUT /location, which also demands Max Capacity and the rest of the form.
   */
  @Get('farm-settings')
  @RequirePermission('INVENTORY', 'LEDGER', 'view')
  @ApiOperation({ summary: "Each farm this caller may open, with its six feed planning settings (D32)" })
  async farmSettings(@Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.feedForecastService.listFarmSettings(tenantId, req.user?.userType);
    return { success: true, message: 'Feed planning settings retrieved successfully.', data };
  }

  @Put('farm-settings/:farmId')
  @RequirePermission('MASTER_DATA', 'LOCATION', 'edit')
  @ApiOperation({ summary: "One farm's feed planning settings; only those six columns are written (D32)" })
  async updateFarmSettings(@Param('farmId', ParseUUIDPipe) farmId: string, @Body() dto: UpdateFeedFarmSettingsDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.feedForecastService.updateFarmSettings(farmId, dto, tenantId, req.user);
    return { success: true, message: 'Feed planning settings updated.', data };
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
