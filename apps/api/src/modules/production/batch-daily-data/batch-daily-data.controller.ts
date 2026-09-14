import { Controller, Get, Post, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { BatchDailyDataService } from './batch-daily-data.service';
import { CreateBatchDailyDataDto } from './dto/batch-daily-data.dto';
import { CreateUnscheduledHealthDto, RejectUnscheduledHealthDto } from './dto/unscheduled-health.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';

@ApiTags('Batch Daily Data')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('batch/:batchId/daily-data')
@FarmScoped()
export class BatchDailyDataController {
  /*
   * Guarded by PRODUCTION/BATCH_ENTRY, not BATCH_SCHEDULE. Designing a schedule
   * and recording against one are different jobs: an operator needs the second
   * without the first, and under the old resource could not post at all.
   *
   * `create` covers recording a day, including a day still owed. `edit` is not
   * required to post — it is what lifts the worker's fence on changing a past
   * day, and the service reads it directly because whether an entry may change
   * depends on its date, which no decorator can see.
   */
  constructor(private readonly batchDailyDataService: BatchDailyDataService) {}

  @Post()
  @RequirePermission('PRODUCTION', 'BATCH_ENTRY', 'create')
  @ApiOperation({ summary: 'Post one scheduler_line entry for a date — dispatches to inventory/GL/animal-transfer per line_type, same day+line upserts' })
  @ApiParam({ name: 'batchId', description: 'Batch UUID' })
  async postEntry(@Param('batchId') batchId: string, @Body() dto: CreateBatchDailyDataDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.batchDailyDataService.postEntry(batchId, dto, tenantId, req.user);
    return { success: true, message: 'Entry posted.', data: result };
  }

  @Get('day-status')
  @RequirePermission('PRODUCTION', 'BATCH_ENTRY', 'view')
  @ApiOperation({ summary: "Per-stage status for one date: animal count, lines due, and whether every mandatory one is answered" })
  @ApiParam({ name: 'batchId', description: 'Batch UUID' })
  @ApiQuery({ name: 'date', description: 'YYYY-MM-DD', required: true })
  async dayStatus(@Param('batchId') batchId: string, @Query('date') date: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.batchDailyDataService.dayStatus(batchId, date, tenantId);
    return { success: true, message: 'Day status retrieved.', data };
  }

  @Get('pending-days')
  @RequirePermission('PRODUCTION', 'BATCH_ENTRY', 'view')
  @ApiOperation({ summary: "Days from the batch start still missing a mandatory entry, oldest first — the backlog before today can be entered" })
  @ApiParam({ name: 'batchId', description: 'Batch UUID' })
  @ApiQuery({ name: 'upTo', description: "YYYY-MM-DD; defaults to today on the farm", required: false })
  async pendingDays(@Param('batchId') batchId: string, @Req() req: any, @Query('upTo') upTo?: string) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.batchDailyDataService.pendingDays(batchId, upTo, tenantId);
    // oldest is what the screen opens on, so it is named rather than implied.
    return { success: true, message: 'Pending days retrieved.', data, oldest: data[0] ?? null };
  }

  @Post('unscheduled-health')
  @RequirePermission('PRODUCTION', 'BATCH_ENTRY', 'create')
  @ApiOperation({ summary: "Report a health event the schedule did not call for — recorded at once as a pending request; its stock and cost wait for approval" })
  @ApiParam({ name: 'batchId', description: 'Batch UUID' })
  async recordUnscheduledHealth(
    @Param('batchId') batchId: string,
    @Body() dto: CreateUnscheduledHealthDto,
    @Req() req: any,
  ) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.batchDailyDataService.recordUnscheduledHealth(batchId, dto, tenantId, req.user);
    return { success: true, message: 'Health event reported and sent for approval.', data };
  }

  @Get('unscheduled-health')
  @RequirePermission('PRODUCTION', 'BATCH_ENTRY', 'view')
  @ApiOperation({ summary: 'Health events raised against this batch outside the schedule' })
  @ApiParam({ name: 'batchId', description: 'Batch UUID' })
  @ApiQuery({ name: 'status', description: 'PENDING, APPROVED or REJECTED', required: false })
  async listUnscheduledHealth(@Param('batchId') batchId: string, @Req() req: any, @Query('status') status?: string) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.batchDailyDataService.listUnscheduledHealth(batchId, tenantId, status);
    return { success: true, message: 'Health events retrieved.', data };
  }

  @Post('unscheduled-health/:requestId/approve')
  @RequirePermission('PRODUCTION', 'BATCH_ENTRY', 'approve')
  @ApiOperation({ summary: "Approve a health event — issues the medicine against the batch, then records the decision" })
  @ApiParam({ name: 'batchId', description: 'Batch UUID' })
  @ApiParam({ name: 'requestId', description: 'Approval request UUID' })
  async approveUnscheduledHealth(
    @Param('batchId') batchId: string,
    @Param('requestId') requestId: string,
    @Req() req: any,
  ) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.batchDailyDataService.approveUnscheduledHealth(batchId, requestId, tenantId, req.user);
    return { success: true, message: 'Health event approved and posted.', data };
  }

  @Post('unscheduled-health/:requestId/reject')
  @RequirePermission('PRODUCTION', 'BATCH_ENTRY', 'approve')
  @ApiOperation({ summary: 'Reject a health event — nothing is posted and the record stays as part of the trail' })
  @ApiParam({ name: 'batchId', description: 'Batch UUID' })
  @ApiParam({ name: 'requestId', description: 'Approval request UUID' })
  async rejectUnscheduledHealth(
    @Param('batchId') batchId: string,
    @Param('requestId') requestId: string,
    @Body() dto: RejectUnscheduledHealthDto,
    @Req() req: any,
  ) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.batchDailyDataService.rejectUnscheduledHealth(batchId, requestId, dto.rejection_reason, tenantId, req.user);
    return { success: true, message: 'Health event rejected.', data };
  }

  @Get('form')
  @RequirePermission('PRODUCTION', 'BATCH_ENTRY', 'view')
  @ApiOperation({ summary: "Everything one day's entry screen needs: stage ticks, the lines due with standard quantities, prior answers, and per-line editability" })
  @ApiParam({ name: 'batchId', description: 'Batch UUID' })
  @ApiQuery({ name: 'date', description: "YYYY-MM-DD; defaults to today on the farm, which is not necessarily today in the browser", required: false })
  @ApiQuery({ name: 'stageId', description: 'Stage to show lines for; defaults to the first stage still owing work', required: false })
  async entryForm(
    @Param('batchId') batchId: string,
    @Req() req: any,
    @Query('date') date?: string,
    @Query('stageId') stageId?: string,
  ) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.batchDailyDataService.entryForm(batchId, date, tenantId, req.user, stageId);
    return { success: true, message: 'Entry form retrieved.', data };
  }

  @Get('entry-dates')
  @RequirePermission('PRODUCTION', 'BATCH_ENTRY', 'view')
  @ApiOperation({ summary: 'Dates this batch has anything recorded on, newest first — the right-hand history list' })
  @ApiParam({ name: 'batchId', description: 'Batch UUID' })
  async entryDates(@Param('batchId') batchId: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.batchDailyDataService.entryDates(batchId, tenantId);
    return { success: true, message: 'Entry dates retrieved.', data };
  }

  @Get()
  @RequirePermission('PRODUCTION', 'BATCH_ENTRY', 'view')
  @ApiOperation({ summary: 'List entries already recorded for this batch on a given date' })
  @ApiParam({ name: 'batchId', description: 'Batch UUID' })
  @ApiQuery({ name: 'date', description: 'YYYY-MM-DD', required: true })
  async findForDate(@Param('batchId') batchId: string, @Query('date') date: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.batchDailyDataService.findForDate(batchId, date, tenantId);
    return { success: true, message: 'Entries retrieved.', data: result };
  }
}
