import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FeedForecastService } from './feed-forecast.service';
import { QueryFeedForecastDto } from './dto/feed-forecast.dto';
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

  @Get()
  @RequirePermission('INVENTORY', 'LEDGER', 'view')
  @ApiOperation({ summary: "Feed forecast for one farm: each batch's demand, its silo or store, and when that runs down" })
  async get(@Query() query: QueryFeedForecastDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.feedForecastService.getForecast(query, tenantId);
    return {
      success: true,
      message: 'Feed forecast retrieved successfully.',
      data: result,
    };
  }
}
