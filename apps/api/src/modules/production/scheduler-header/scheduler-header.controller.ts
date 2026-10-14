import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { SchedulerHeaderService } from './scheduler-header.service';
import {
  CreateSchedulerHeaderDto, UpdateSchedulerHeaderDto,
  GenerateSchedulerHeaderDto, QuerySchedulerHeaderDto, UpdateSchedulerHeaderStatusDto,
  CreateSchedulerLineDto, UpdateSchedulerLineDto, CopySchedulerLinesDto, UpdateSchedulerFeedLinesDto,
} from './dto/scheduler-header.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';

@ApiTags('Batch Schedules')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('scheduler-header')
export class SchedulerHeaderController {
  constructor(private readonly schedulerHeaderService: SchedulerHeaderService) {}

  @Post()
  @RequirePermission('PRODUCTION', 'BATCH_SCHEDULE', 'create')
  @ApiOperation({ summary: 'Manually create a new scheduler_header for a batch and stage' })
  async create(@Body() dto: CreateSchedulerHeaderDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.schedulerHeaderService.createManualHeader(dto, tenantId, req.user);
    return { success: true, message: 'Scheduler created successfully.', data: result };
  }

  @Get()
  @RequirePermission('PRODUCTION', 'BATCH_SCHEDULE', 'view')
  @ApiOperation({ summary: "List scheduler_header rows — pass batchId for one batch's schedule history (one per stage), or companyId for the company-wide Schedulers list" })
  async findAll(@Query() query: QuerySchedulerHeaderDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    if (query.batchId) {
      const result = await this.schedulerHeaderService.findAllForBatch(query.batchId, tenantId);
      return { success: true, message: 'Scheduler headers retrieved.', data: result };
    }
    const result = await this.schedulerHeaderService.findAllForCompany(query, tenantId);
    return { success: true, message: 'Scheduler headers retrieved.', data: result };
  }

  @Patch(':id')
  @RequirePermission('PRODUCTION', 'BATCH_SCHEDULE', 'edit')
  @ApiOperation({ summary: 'Update scheduler details (notes, data_entry_level, effective dates, animal_count)' })
  @ApiParam({ name: 'id', description: 'Scheduler UUID' })
  async update(@Param('id') id: string, @Body() dto: UpdateSchedulerHeaderDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.schedulerHeaderService.updateHeader(id, dto, tenantId, req.user);
    return { success: true, message: 'Scheduler updated successfully.', data: result };
  }

  @Post('generate')
  @RequirePermission('PRODUCTION', 'BATCH_SCHEDULE', 'create')
  @ApiOperation({ summary: "Manually (re)generate the schedule for a batch's current stage — same idempotent path transferStage() calls automatically" })
  async generate(@Body() dto: GenerateSchedulerHeaderDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    // Resolve the batch's current stage_id from batch_header directly — kept
    // thin here rather than importing BatchService, to avoid a circular
    // module dependency between scheduler-header and batch.
    const result = await this.schedulerHeaderService.generateForBatchCurrentStage(dto.batch_id, tenantId, req.user);
    return { success: true, message: 'Scheduler generated.', data: result };
  }

  @Get(':id')
  @RequirePermission('PRODUCTION', 'BATCH_SCHEDULE', 'view')
  @ApiOperation({ summary: 'Fetch a scheduler_header with its lines and custom days' })
  @ApiParam({ name: 'id', description: 'Scheduler UUID' })
  async findOne(@Param('id') id: string) {
    const result = await this.schedulerHeaderService.findOne(id);
    return { success: true, message: 'Scheduler retrieved.', data: result };
  }

  @Delete(':id')
  @RequirePermission('PRODUCTION', 'BATCH_SCHEDULE', 'delete')
  @ApiOperation({ summary: 'Delete an unused scheduler (refused with 409 if any of its lines has a recorded entry)' })
  @ApiParam({ name: 'id', description: 'Scheduler UUID' })
  async remove(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.schedulerHeaderService.deleteHeader(id, tenantId, req.user);
    return { success: true, message: 'Scheduler deleted successfully.', data: result };
  }

  @Put(':id/status')
  @RequirePermission('PRODUCTION', 'BATCH_SCHEDULE', 'edit')
  @ApiOperation({ summary: 'Transition scheduler_status (DRAFT -> ACTIVE requires the calling user as approver)' })
  @ApiParam({ name: 'id', description: 'Scheduler UUID' })
  async updateStatus(@Param('id') id: string, @Body() dto: UpdateSchedulerHeaderStatusDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.schedulerHeaderService.updateStatus(id, dto, tenantId, req.user);
    return { success: true, message: 'Scheduler status updated.', data: result };
  }

  @Post(':id/lines')
  @RequirePermission('PRODUCTION', 'BATCH_SCHEDULE', 'edit')
  @ApiOperation({ summary: 'Add a MANUAL line to a scheduler' })
  @ApiParam({ name: 'id', description: 'Scheduler UUID' })
  async addLine(@Param('id') id: string, @Body() dto: CreateSchedulerLineDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.schedulerHeaderService.addLine(id, dto, tenantId, req.user);
    return { success: true, message: 'Line added.', data: result };
  }

  @Post(':id/copy-lines')
  @RequirePermission('PRODUCTION', 'BATCH_SCHEDULE', 'edit')
  @ApiOperation({ summary: 'Fill an empty scheduler with the activities of a system scheduler or another batch\'s scheduler' })
  @ApiParam({ name: 'id', description: 'Scheduler UUID' })
  async copyLines(@Param('id') id: string, @Body() dto: CopySchedulerLinesDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.schedulerHeaderService.copyLinesInto(id, dto, tenantId, req.user);
    return { success: true, message: 'Activities copied.', data: result };
  }

  @Put(':id/feed-lines')
  @RequirePermission('PRODUCTION', 'BATCH_SCHEDULE', 'edit')
  @ApiOperation({
    summary: "Replace the scheduler's Feed Consumption lines",
    description:
      'The whole feed line set, in the same shape as a breed lifecycle stage\'s: stage days; several feeds may share '
      + 'days, but a feed is on a day once and no day between the first and last line is without feed. Days already entered keep the feed they were posted against — such a line is cut '
      + 'back to its last entered day and the new feed starts the day after.',
  })
  @ApiParam({ name: 'id', description: 'Scheduler UUID' })
  async updateFeedLines(@Param('id') id: string, @Body() dto: UpdateSchedulerFeedLinesDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.schedulerHeaderService.updateFeedLines(id, dto.lines as any, tenantId, req.user);
    return { success: true, message: 'Feed lines updated.', data: result };
  }

  @Put(':id/lines/:lineId')
  @RequirePermission('PRODUCTION', 'BATCH_SCHEDULE', 'edit')
  @ApiOperation({ summary: 'Update a line' })
  @ApiParam({ name: 'id', description: 'Scheduler UUID' })
  @ApiParam({ name: 'lineId', description: 'Line UUID' })
  async updateLine(@Param('id') id: string, @Param('lineId') lineId: string, @Body() dto: UpdateSchedulerLineDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.schedulerHeaderService.updateLine(id, lineId, dto, tenantId, req.user);
    return { success: true, message: 'Line updated.', data: result };
  }

  @Delete(':id/lines/:lineId')
  @RequirePermission('PRODUCTION', 'BATCH_SCHEDULE', 'delete')
  @ApiOperation({ summary: 'Deactivate a line (hidden from data entry, history kept)' })
  @ApiParam({ name: 'id', description: 'Scheduler UUID' })
  @ApiParam({ name: 'lineId', description: 'Line UUID' })
  async removeLine(@Param('id') id: string, @Param('lineId') lineId: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.schedulerHeaderService.removeLine(id, lineId, tenantId, req.user);
    return { success: true, message: 'Line deactivated.', data: result };
  }
}
