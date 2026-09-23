import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { StageService } from './stage.service';
import { CreateStageDto, UpdateStageDto, QueryStageDto } from './dto/stage.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';

@ApiTags('Production Stages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('stage')
export class StageController {
  constructor(private readonly stageService: StageService) {}

  @Post()
  @RequirePermission('PRODUCTION', 'STAGE', 'create')
  @ApiOperation({ summary: 'Create a production lifecycle Stage (e.g. "Quarantine")' })
  async create(@Body() dto: CreateStageDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.stageService.create(dto, tenantId, req.user);
    return { success: true, message: 'Stage created successfully.', data: result };
  }

  @Get()
  @RequirePermission('PRODUCTION', 'STAGE', 'view')
  @ApiOperation({ summary: 'List Stages matching filters, ordered by stage_sequence' })
  async findAll(@Query() query: QueryStageDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.stageService.findAll(query, tenantId);
    return { success: true, message: 'Stages retrieved successfully.', data: result };
  }

  @Get(':id')
  @RequirePermission('PRODUCTION', 'STAGE', 'view')
  @ApiOperation({ summary: 'Fetch a single Stage' })
  @ApiParam({ name: 'id', description: 'Stage UUID' })
  async findOne(@Param('id') id: string) {
    const result = await this.stageService.findOne(id);
    return { success: true, message: 'Stage retrieved.', data: result };
  }

  @Put(':id')
  @RequirePermission('PRODUCTION', 'STAGE', 'edit')
  @ApiOperation({ summary: 'Update a Stage' })
  @ApiParam({ name: 'id', description: 'Stage UUID' })
  async update(@Param('id') id: string, @Body() dto: UpdateStageDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.stageService.update(id, dto, tenantId, req.user);
    return { success: true, message: 'Stage updated successfully.', data: result };
  }

  @Delete(':id')
  @RequirePermission('PRODUCTION', 'STAGE', 'delete')
  @ApiOperation({ summary: 'Deactivate a Stage (system-seeded stages cannot be deleted, only deactivated via update)' })
  @ApiParam({ name: 'id', description: 'Stage UUID' })
  async remove(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    return this.stageService.remove(id, tenantId, req.user);
  }

  @Patch(':id/restore')
  @RequirePermission('PRODUCTION', 'STAGE', 'edit')
  @ApiOperation({ summary: 'Restore a deactivated Stage' })
  @ApiParam({ name: 'id', description: 'Stage UUID' })
  async restore(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.stageService.restore(id, tenantId, req.user);
    return { success: true, message: result.message, data: result };
  }
}
