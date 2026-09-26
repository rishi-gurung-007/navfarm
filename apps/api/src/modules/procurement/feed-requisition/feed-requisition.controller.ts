import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';
import { FeedRequisitionService } from './feed-requisition.service';
import {
  AutoDraftFeedRequisitionDto, CreateManualFeedRequisitionDto, DecideFeedRequisitionDto, QueryFeedRequisitionDto, UpdateFeedRequisitionDto,
} from './dto/feed-requisition.dto';

// Feed requisitions ride the Procurement Requisition grant: they are
// requisitions (doc_type FEED), approved by whoever may approve requisitions,
// and only for a farm in the caller's scope (checkpoint 19).
@ApiTags('Feed Requisitions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('feed-requisition')
export class FeedRequisitionController {
  constructor(private readonly feedRequisitions: FeedRequisitionService) {}

  @Get()
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'view')
  @ApiOperation({ summary: "One farm's feed requisitions, newest first" })
  async findAll(@Query() query: QueryFeedRequisitionDto, @Req() req: any) {
    const data = await this.feedRequisitions.findAll(query, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Feed requisitions retrieved successfully.', data };
  }

  @Post('auto-draft')
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'create')
  @ApiOperation({ summary: "Draft (or refresh) the farm's AUTO_DRAFT requisition for this cycle from the feed forecast (Engine Step 9)" })
  async autoDraft(@Body() dto: AutoDraftFeedRequisitionDto, @Req() req: any) {
    const data = await this.feedRequisitions.autoDraft(dto, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: data.requisitionId ? 'Feed requisition drafted.' : 'Nothing to order: stock covers the forecast.', data };
  }

  @Post()
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'create')
  @ApiOperation({ summary: 'Raise a MANUAL feed requisition (Requisition §1 row 7)' })
  async create(@Body() dto: CreateManualFeedRequisitionDto, @Req() req: any) {
    const data = await this.feedRequisitions.createManual(dto, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Feed requisition created.', data };
  }

  @Get(':id')
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'view')
  @ApiParam({ name: 'id' })
  async findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const data = await this.feedRequisitions.findOne(id, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Feed requisition retrieved successfully.', data };
  }

  @Put(':id')
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'create')
  @ApiOperation({ summary: 'Edit requested quantities, delivery dates and remarks of an open feed requisition (Requisition §4 step 3)' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFeedRequisitionDto, @Req() req: any) {
    const data = await this.feedRequisitions.update(id, dto ?? {}, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Feed requisition saved.', data };
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'approve')
  @ApiOperation({ summary: 'Approve: own farm only (cp. 19), remarks over 20 % deviation (cp. 18) or after the deadline (cp. 22)' })
  async approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideFeedRequisitionDto, @Req() req: any) {
    const data = await this.feedRequisitions.approve(id, dto ?? {}, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Feed requisition approved.', data };
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'approve')
  @ApiOperation({ summary: 'Reject an open feed requisition with a reason' })
  async reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideFeedRequisitionDto, @Req() req: any) {
    const data = await this.feedRequisitions.reject(id, dto ?? {}, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Feed requisition rejected.', data };
  }
}
