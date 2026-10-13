import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { SystemSchedulerService } from './system-scheduler.service';
import { CreateSchedulerLineDto, UpdateSchedulerLineDto, CopySchedulerLinesDto } from './dto/scheduler-header.dto';
import {
  CreateSystemSchedulerDto, UpdateSystemSchedulerDto, QuerySystemSchedulerDto, MatchSystemSchedulerDto,
} from './dto/system-scheduler.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';

/** Same permission as batch schedules: a system scheduler is the plan they are copied from. */
@ApiTags('System Schedulers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('system-scheduler')
export class SystemSchedulerController {
  constructor(private readonly systemSchedulerService: SystemSchedulerService) {}

  @Post()
  @RequirePermission('PRODUCTION', 'BATCH_SCHEDULE', 'create')
  @ApiOperation({ summary: 'Create a system scheduler — a stage\'s standard activities, for batches to copy' })
  async create(@Body() dto: CreateSystemSchedulerDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.systemSchedulerService.create(dto, tenantId, req.user);
    return { success: true, message: 'System scheduler created successfully.', data: result };
  }

  @Get()
  @RequirePermission('PRODUCTION', 'BATCH_SCHEDULE', 'view')
  @ApiOperation({ summary: 'List system schedulers, in stage order' })
  async findAll(@Query() query: QuerySystemSchedulerDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.systemSchedulerService.findAll(query, tenantId);
    return { success: true, message: 'System schedulers retrieved.', data: result };
  }

  @Get('match')
  @RequirePermission('PRODUCTION', 'BATCH_SCHEDULE', 'view')
  @ApiOperation({ summary: 'Which of these stages has a system scheduler a batch of this breed would copy' })
  async match(@Query() query: MatchSystemSchedulerDto) {
    const result = await this.systemSchedulerService.match(query);
    return { success: true, message: 'System scheduler matches retrieved.', data: result };
  }

  @Get(':id')
  @RequirePermission('PRODUCTION', 'BATCH_SCHEDULE', 'view')
  @ApiParam({ name: 'id', description: 'System scheduler UUID' })
  async findOne(@Param('id') id: string) {
    const result = await this.systemSchedulerService.findOne(id);
    return { success: true, message: 'System scheduler retrieved.', data: result };
  }

  @Patch(':id')
  @RequirePermission('PRODUCTION', 'BATCH_SCHEDULE', 'edit')
  @ApiOperation({ summary: 'Update name, data entry level, notes or active flag' })
  @ApiParam({ name: 'id', description: 'System scheduler UUID' })
  async update(@Param('id') id: string, @Body() dto: UpdateSystemSchedulerDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.systemSchedulerService.update(id, dto, tenantId, req.user);
    return { success: true, message: 'System scheduler updated successfully.', data: result };
  }

  @Delete(':id')
  @RequirePermission('PRODUCTION', 'BATCH_SCHEDULE', 'delete')
  @ApiOperation({ summary: 'Delete a system scheduler (batch schedulers already copied from it keep their lines)' })
  @ApiParam({ name: 'id', description: 'System scheduler UUID' })
  async remove(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.systemSchedulerService.remove(id, tenantId, req.user);
    return { success: true, message: 'System scheduler deleted successfully.', data: result };
  }

  @Post(':id/lines')
  @RequirePermission('PRODUCTION', 'BATCH_SCHEDULE', 'edit')
  @ApiParam({ name: 'id', description: 'System scheduler UUID' })
  async addLine(@Param('id') id: string, @Body() dto: CreateSchedulerLineDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.systemSchedulerService.addLine(id, dto, tenantId, req.user);
    return { success: true, message: 'Line added.', data: result };
  }

  @Post(':id/copy-lines')
  @RequirePermission('PRODUCTION', 'BATCH_SCHEDULE', 'edit')
  @ApiOperation({ summary: 'Fill an empty system scheduler with the activities of another one or of a batch\'s scheduler' })
  @ApiParam({ name: 'id', description: 'System scheduler UUID' })
  async copyLines(@Param('id') id: string, @Body() dto: CopySchedulerLinesDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.systemSchedulerService.copyLinesInto(id, dto, tenantId, req.user);
    return { success: true, message: 'Activities copied.', data: result };
  }

  @Put(':id/lines/:lineId')
  @RequirePermission('PRODUCTION', 'BATCH_SCHEDULE', 'edit')
  @ApiParam({ name: 'id', description: 'System scheduler UUID' })
  @ApiParam({ name: 'lineId', description: 'Line UUID' })
  async updateLine(@Param('id') id: string, @Param('lineId') lineId: string, @Body() dto: UpdateSchedulerLineDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.systemSchedulerService.updateLine(id, lineId, dto, tenantId, req.user);
    return { success: true, message: 'Line updated.', data: result };
  }

  @Delete(':id/lines/:lineId')
  @RequirePermission('PRODUCTION', 'BATCH_SCHEDULE', 'delete')
  @ApiParam({ name: 'id', description: 'System scheduler UUID' })
  @ApiParam({ name: 'lineId', description: 'Line UUID' })
  async removeLine(@Param('id') id: string, @Param('lineId') lineId: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.systemSchedulerService.removeLine(id, lineId, tenantId, req.user);
    return { success: true, message: 'Line removed.', data: result };
  }
}
