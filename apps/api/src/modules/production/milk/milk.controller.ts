import { Controller, Get, Post, Delete, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { MilkService } from './milk.service';
import { RecordMilkDto, QueryMilkDto } from './dto/milk.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';

@ApiTags('Dairy Milk Production')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('milk-production')
export class MilkController {
  constructor(private readonly milkService: MilkService) {}

  @Get()
  @RequirePermission('PRODUCTION', 'BATCH', 'view')
  @ApiOperation({ summary: 'List milk production records' })
  async findAll(@Query() query: QueryMilkDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.milkService.findAll(query, tenantId);
    return { success: true, message: 'Milk records retrieved successfully.', data };
  }

  @Get('daily-summary')
  @RequirePermission('PRODUCTION', 'BATCH', 'view')
  @ApiOperation({ summary: "One day's sessions, live milking head count and yield per cow" })
  @ApiQuery({ name: 'batch_id' })
  @ApiQuery({ name: 'log_date', example: '2026-08-25' })
  async dailySummary(@Query('batch_id') batchId: string, @Query('log_date') logDate: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.milkService.dailySummary(batchId, logDate, tenantId);
    return { success: true, message: 'Daily summary retrieved successfully.', data };
  }

  @Get('daily-costs')
  @RequirePermission('PRODUCTION', 'BATCH', 'view')
  @ApiOperation({ summary: "The day's recorded cost lines for a batch, grouped for the dairy screen" })
  @ApiQuery({ name: 'batch_id' })
  @ApiQuery({ name: 'log_date', example: '2026-08-25' })
  async dailyCosts(@Query('batch_id') batchId: string, @Query('log_date') logDate: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.milkService.dailyCosts(batchId, logDate, tenantId);
    return { success: true, message: 'Daily costs retrieved successfully.', data };
  }

  @Post()
  @RequirePermission('PRODUCTION', 'BATCH', 'edit')
  @ApiOperation({ summary: 'Record (or correct) one milking session' })
  async record(@Body() dto: RecordMilkDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.milkService.record(dto, tenantId, req.user);
    return { success: true, message: 'Milk production recorded successfully.', data };
  }

  @Delete(':id')
  @RequirePermission('PRODUCTION', 'BATCH', 'delete')
  async remove(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.milkService.remove(id, tenantId, req.user);
    return { success: true, message: 'Milk record removed.', data };
  }
}
