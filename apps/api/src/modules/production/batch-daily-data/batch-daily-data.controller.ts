import { Controller, Get, Post, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { BatchDailyDataService } from './batch-daily-data.service';
import { CreateBatchDailyDataDto } from './dto/batch-daily-data.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';

@ApiTags('Batch Daily Data')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('batch/:batchId/daily-data')
export class BatchDailyDataController {
  constructor(private readonly batchDailyDataService: BatchDailyDataService) {}

  @Post()
  @RequirePermission('PRODUCTION', 'BATCH_SCHEDULE', 'create')
  @ApiOperation({ summary: 'Post one scheduler_line entry for a date — dispatches to inventory/GL/animal-transfer per line_type, same day+line upserts' })
  @ApiParam({ name: 'batchId', description: 'Batch UUID' })
  async postEntry(@Param('batchId') batchId: string, @Body() dto: CreateBatchDailyDataDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.batchDailyDataService.postEntry(batchId, dto, tenantId, req.user);
    return { success: true, message: 'Entry posted.', data: result };
  }

  @Get('day-status')
  @RequirePermission('PRODUCTION', 'BATCH_SCHEDULE', 'view')
  @ApiOperation({ summary: "Per-stage status for one date: animal count, lines due, and whether every mandatory one is answered" })
  @ApiParam({ name: 'batchId', description: 'Batch UUID' })
  @ApiQuery({ name: 'date', description: 'YYYY-MM-DD', required: true })
  async dayStatus(@Param('batchId') batchId: string, @Query('date') date: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.batchDailyDataService.dayStatus(batchId, date, tenantId);
    return { success: true, message: 'Day status retrieved.', data };
  }

  @Get('pending-days')
  @RequirePermission('PRODUCTION', 'BATCH_SCHEDULE', 'view')
  @ApiOperation({ summary: "Days from the batch start still missing a mandatory entry, oldest first — the backlog before today can be entered" })
  @ApiParam({ name: 'batchId', description: 'Batch UUID' })
  @ApiQuery({ name: 'upTo', description: 'YYYY-MM-DD, usually today', required: true })
  async pendingDays(@Param('batchId') batchId: string, @Query('upTo') upTo: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.batchDailyDataService.pendingDays(batchId, upTo, tenantId);
    // oldest is what the screen opens on, so it is named rather than implied.
    return { success: true, message: 'Pending days retrieved.', data, oldest: data[0] ?? null };
  }

  @Get()
  @RequirePermission('PRODUCTION', 'BATCH_SCHEDULE', 'view')
  @ApiOperation({ summary: 'List entries already recorded for this batch on a given date' })
  @ApiParam({ name: 'batchId', description: 'Batch UUID' })
  @ApiQuery({ name: 'date', description: 'YYYY-MM-DD', required: true })
  async findForDate(@Param('batchId') batchId: string, @Query('date') date: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.batchDailyDataService.findForDate(batchId, date, tenantId);
    return { success: true, message: 'Entries retrieved.', data: result };
  }
}
