import { Body, Controller, Get, HttpCode, Optional, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';
import { FeedRequisitionService } from './feed-requisition.service';
import {
  AutoDraftFeedRequisitionDto, CreateManualFeedRequisitionDto, QueryFeedRequisitionDto, UpdateFeedRequisitionDto,
  CreateFeedRequisitionFromRunDto, FeedRequisitionReceiptDto, FeedRequisitionShipmentDto,
  CreateFeedConsolidationDto, FeedConsolidationQueryDto,
} from './dto/feed-requisition.dto';
import { FeedConsolidationService } from './feed-consolidation.service';
import { FeedLoadingService } from './feed-loading.service';

// Feed requisitions ride the Procurement Requisition grant: drafted and
// submitted here, approved in the Approvals inbox (D25) by whoever may approve
// requisitions, and only for a farm in the caller's scope (checkpoint 19).
@ApiTags('Feed Requisitions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('feed-requisition')
export class FeedRequisitionController {
  constructor(private readonly feedRequisitions: FeedRequisitionService, @Optional() private readonly consolidations?: FeedConsolidationService, @Optional() private readonly loading?: FeedLoadingService) {}

  @Get()
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'view')
  @ApiOperation({ summary: "One farm's feed requisitions, newest first" })
  async findAll(@Query() query: QueryFeedRequisitionDto, @Req() req: any) {
    const data = await this.feedRequisitions.findAll(query, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Feed requisitions retrieved successfully.', data };
  }

  @Get('options')
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'view')
  @ApiOperation({ summary: "What a manual requisition may name: the farm's silos and stores, and its company's feed items" })
  async options(@Query() query: QueryFeedRequisitionDto, @Req() req: any) {
    const data = await this.feedRequisitions.options(query.farmId, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Feed requisition options retrieved successfully.', data };
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

  @Get('consolidations/eligible')
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'approve')
  @ApiOperation({ summary: 'Approved feed requisition lines without a mill consolidation sheet' })
  async eligibleConsolidationLines(@Query() query: FeedConsolidationQueryDto, @Req() req: any) {
    const data = await this.consolidations!.eligible(query, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Eligible feed requisitions retrieved.', data };
  }

  @Post('consolidations')
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'approve')
  @ApiOperation({ summary: 'Create a feed-only mill consolidation sheet' })
  async createConsolidation(@Body() dto: CreateFeedConsolidationDto, @Req() req: any) {
    const data = await this.consolidations!.create(dto, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Feed mill consolidation sheet created.', data };
  }

  @Get('consolidations')
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'view')
  async listConsolidations(@Query() query: FeedConsolidationQueryDto, @Req() req: any) {
    const data = await this.consolidations!.list(query, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Feed consolidation sheets retrieved.', data };
  }

  @Get('consolidations/:id')
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'view')
  async getConsolidation(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const data = await this.consolidations!.findOne(id, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Feed consolidation sheet retrieved.', data };
  }

  @Post('consolidations/:id/finalize')
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'approve')
  async finalizeConsolidation(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const data = await this.consolidations!.finalize(id, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Feed consolidation sheet finalized.', data };
  }

  @Post('consolidations/:id/loading-sheets')
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'approve')
  async createLoadingSheets(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const data = await this.loading!.createForConsolidation(id, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: data.existing ? 'Loading sheets already exist.' : 'Feed loading sheets created.', data };
  }

  @Get('loading-sheets')
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'view')
  async loadingSheets(@Query('consolidationId') consolidationId: string | undefined, @Req() req: any) {
    const data = await this.loading!.list(req.user?.tenantId || req['tenantId'], consolidationId);
    return { success: true, message: 'Feed loading sheets retrieved.', data };
  }

  @Get('loading-sheets/:id')
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'view')
  async loadingSheet(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const data = await this.loading!.findOne(id, req.user?.tenantId || req['tenantId']);
    return { success: true, message: 'Feed loading sheet retrieved.', data };
  }

  @Put('loading-sheets/:id')
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'approve')
  async updateLoadingSheet(@Param('id', ParseUUIDPipe) id: string, @Body() dto: { compartmentNo?: string; kgLoaded?: number; loadedBy?: string }, @Req() req: any) {
    const data = await this.loading!.update(id, dto, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Feed loading sheet updated.', data };
  }

  @Post('loading-sheets/:id/dispatch')
  @HttpCode(200)
  @RequirePermission('INVENTORY', 'STOCK_TRANSFER', 'edit')
  async dispatchLoadingSheet(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const data = await this.loading!.dispatch(id, req.user?.tenantId || req['tenantId']);
    return { success: true, message: 'Feed loading sheet marked dispatched.', data };
  }

  @Get('from-run/:runId/preview')
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'view')
  @ApiOperation({ summary: 'Preview an editable feed requisition from one exact saved calculation' })
  async previewFromRun(@Param('runId', ParseUUIDPipe) runId: string, @Req() req: any) {
    const data = await this.feedRequisitions.previewFromRun(runId, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Feed requisition preview retrieved.', data };
  }

  @Post('from-run/:runId')
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'create')
  @ApiOperation({ summary: 'Create one editable feed requisition from one exact saved calculation' })
  async createFromRun(@Param('runId', ParseUUIDPipe) runId: string, @Body() dto: CreateFeedRequisitionFromRunDto, @Req() req: any) {
    const data = await this.feedRequisitions.createFromRun(runId, dto, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Feed requisition created from saved calculation.', data };
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

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'create')
  @ApiOperation({ summary: 'Submit an open feed requisition to the Approvals inbox (D25); remarks needed over 20 % deviation (cp. 18) or after the deadline (cp. 22)' })
  async submit(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFeedRequisitionDto, @Req() req: any) {
    const data = await this.feedRequisitions.submit(id, dto ?? {}, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Feed requisition submitted for approval.', data };
  }

  @Post(':id/release')
  @HttpCode(200)
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'approve')
  @ApiOperation({ summary: 'Release an approved feed requisition into its mill BIN to farm SILO transfers' })
  async release(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const data = await this.feedRequisitions.release(id, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Feed requisition released.', data };
  }

  @Post(':id/shipments')
  @HttpCode(200)
  @RequirePermission('INVENTORY', 'STOCK_TRANSFER', 'edit')
  @ApiOperation({ summary: 'Post a shipment against one transfer created by this feed requisition' })
  async shipment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: FeedRequisitionShipmentDto, @Req() req: any) {
    const data = await this.feedRequisitions.shipment(id, dto, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Feed transfer shipment posted.', data };
  }

  @Post(':id/receipts')
  @HttpCode(200)
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'view')
  @ApiOperation({ summary: 'Post a receipt against a shipment belonging to this feed requisition' })
  async receipt(@Param('id', ParseUUIDPipe) id: string, @Body() dto: FeedRequisitionReceiptDto, @Req() req: any) {
    const data = await this.feedRequisitions.receipt(id, dto, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Feed transfer receipt posted.', data };
  }
}
