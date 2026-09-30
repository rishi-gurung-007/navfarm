import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';
import { FeedAlertService } from './feed-alert.service';
import { EvaluateFeedAlertDto, QueryFeedAlertDto } from './dto/feed-alert.dto';

// Under the Inventory Ledger grant, like the forecast: whoever may see a
// silo's balance may see that it is low. Evaluate is idempotent (one open
// alert per rule and subject), so it needs no stronger grant (L15).
@ApiTags('Feed Alerts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('feed-alert')
export class FeedAlertController {
  constructor(private readonly alerts: FeedAlertService) {}

  @Get()
  @RequirePermission('INVENTORY', 'LEDGER', 'view')
  @ApiOperation({ summary: 'Feed alerts of one farm visible to the caller' })
  async list(@Query() query: QueryFeedAlertDto, @Req() req: any) {
    const data = await this.alerts.list(query, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Feed alerts retrieved successfully.', data };
  }

  @Post('evaluate')
  @RequirePermission('INVENTORY', 'LEDGER', 'view')
  @ApiOperation({ summary: 'Evaluate every feed alert rule for one farm now (there is no scheduler)' })
  async evaluate(@Body() dto: EvaluateFeedAlertDto, @Req() req: any) {
    const data = await this.alerts.evaluateNow(dto?.farmId, req.user?.tenantId || req['tenantId'], req.user?.userType);
    return { success: true, message: 'Feed alerts evaluated.', data };
  }

  // D24: the Alerts page reads and evaluates every farm the user may open,
  // under the same grant as the single-farm routes.
  @Get('scope')
  @RequirePermission('INVENTORY', 'LEDGER', 'view')
  @ApiOperation({ summary: 'Feed alerts of every farm the caller may open, or of one (D24)' })
  async listScope(@Query() query: QueryFeedAlertDto, @Req() req: any) {
    const data = await this.alerts.listScope(query, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Feed alerts retrieved successfully.', data };
  }

  @Post('evaluate-scope')
  @HttpCode(200)
  @RequirePermission('INVENTORY', 'LEDGER', 'view')
  @ApiOperation({ summary: 'Evaluate the feed alert rules of every farm the caller may open (D24; there is no scheduler)' })
  async evaluateScope(@Req() req: any) {
    const data = await this.alerts.evaluateScope(req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Feed alerts evaluated.', data };
  }

  @Post(':id/acknowledge')
  @RequirePermission('INVENTORY', 'LEDGER', 'view')
  @ApiOperation({ summary: 'Acknowledge a feed alert — stops its escalation' })
  async acknowledge(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const data = await this.alerts.acknowledge(id, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Feed alert acknowledged.', data };
  }
}
