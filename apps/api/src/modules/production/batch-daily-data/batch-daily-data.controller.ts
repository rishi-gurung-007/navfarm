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
