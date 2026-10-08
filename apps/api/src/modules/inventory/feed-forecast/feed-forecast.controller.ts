import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FeedForecastService } from './feed-forecast.service';
import { QueryFeedForecastDto, QueryFeedForecastRunsDto, QueryFeedPeriodsDto, QuerySiloStatusDto, UpdateSiloPlanningDto } from './dto/feed-forecast.dto';
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

  @Get('runs')
  @RequirePermission('INVENTORY', 'LEDGER', 'view')
  @ApiOperation({ summary: 'Immutable feed forecast run history for one farm' })
  async runs(@Query() query: QueryFeedForecastRunsDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.feedForecastService.listRuns(query.farmId, tenantId, req.user?.userType);
    return { success: true, message: 'Feed forecast runs retrieved successfully.', data };
  }

  @Get('runs/current')
  @RequirePermission('INVENTORY', 'LEDGER', 'view')
  @ApiOperation({ summary: 'The saved, non-archived feed forecast calculation for one farm' })
  async currentRun(@Query() query: QueryFeedForecastRunsDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.feedForecastService.currentRun(query.farmId, tenantId, req.user?.userType);
    return { success: true, message: 'Current feed forecast run retrieved successfully.', data };
  }

  @Get('feed-plan')
  @RequirePermission('INVENTORY', 'LEDGER', 'view')
  @ApiOperation({ summary: 'Saved feed plan with requisition and transfer fulfilment for one farm' })
  async feedPlan(@Query('farmId') farmId: string | undefined, @Query('from') from: string | undefined, @Query('to') to: string | undefined, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.feedForecastService.feedPlan(farmId, tenantId, req.user?.userType, from, to);
    return { success: true, message: 'Feed plan retrieved successfully.', data };
  }

  @Get('runs/:id')
  @RequirePermission('INVENTORY', 'LEDGER', 'view')
  @ApiOperation({ summary: 'One immutable feed forecast run and its dated lines' })
  async run(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.feedForecastService.findRun(id, tenantId);
    return { success: true, message: 'Feed forecast run retrieved successfully.', data };
  }

  @Delete('runs/:id')
  @RequirePermission('INVENTORY', 'LEDGER', 'create')
  @ApiOperation({ summary: 'Archive the current calculation so the farm can calculate again' })
  async archiveRun(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.feedForecastService.archiveRun(id, tenantId, req.user);
    return { success: true, message: 'Feed forecast calculation archived.', data };
  }

  /**
   * Farms with their feed-planning override values and silos, for Settings →
   * Inventory Setup → Feed Planning. Read under the report's grant, like 'farms'
   * above. The override values are written through PUT /feed-settings/farm
   * (Task 8: they moved off location_master onto feed_planning_setting).
   */
  @Get('farm-settings')
  @RequirePermission('INVENTORY', 'LEDGER', 'view')
  @ApiOperation({ summary: "Each farm this caller may open, with its feed planning override values and silos" })
  async farmSettings(@Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.feedForecastService.listFarmSettings(tenantId, req.user?.userType);
    return { success: true, message: 'Feed planning settings retrieved successfully.', data };
  }

  /**
   * D41: a silo's levels and feed type, from Feed Planning
   * (low_level_kg, high_level_kg, feedType — UpdateSiloPlanningDto rejects
   * silo_reorder_days; M1, final whole-branch review). Written under the
   * location master's own edit right, like the farm settings above — the row
   * being changed is a silo's master row — and never through the generic
   * PUT /location, which demands the whole silo form.
   */
  @Put('farm-settings/:farmId/silos/:siloId')
  @RequirePermission('MASTER_DATA', 'LOCATION', 'edit')
  @ApiOperation({ summary: "One silo's feed levels and feed type; only those three columns are written (D41)" })
  async updateSiloSettings(
    @Param('farmId', ParseUUIDPipe) farmId: string,
    @Param('siloId', ParseUUIDPipe) siloId: string,
    @Body() dto: UpdateSiloPlanningDto,
    @Req() req: any,
  ) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.feedForecastService.updateSiloSettings(farmId, siloId, dto, tenantId, req.user);
    return { success: true, message: 'Silo feed planning updated.', data };
  }

  // Silo dashboard (TDD Engine §4, Master Setup §1): read under the forecast's own grant and farm scope.
  @Get('silo-status')
  @RequirePermission('INVENTORY', 'LEDGER', 'view')
  @ApiOperation({ summary: 'Bootstrap Farm → Shed → Silo options, then return the selected Silo dashboard from one Farm calculation' })
  async siloStatus(@Query() query: QuerySiloStatusDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.feedForecastService.siloStatus(query, tenantId, req.user?.userType);
    return { success: true, message: 'Silo status retrieved successfully.', data };
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

  @Post('runs')
  @RequirePermission('INVENTORY', 'LEDGER', 'create')
  @ApiOperation({ summary: 'Save the displayed feed forecast as an immutable run' })
  async saveRun(@Body() dto: QueryFeedForecastDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.feedForecastService.saveRun(dto, tenantId, req.user);
    return { success: true, message: 'Feed forecast run saved.', data };
  }
}
