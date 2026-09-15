import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { BreedService } from './breed.service';
import { CreateBreedLifecycleStageDto, UpdateBreedLifecycleStageDto, QueryBreedLifecycleStageDto } from './dto/breed.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';

@ApiTags('Breed Lifecycle Stages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('breed-lifecycle-stage')
export class BreedLifecycleStageController {
  constructor(private readonly breedService: BreedService) {}

  @Post()
  @RequirePermission('MASTER_DATA', 'BREED_LIFECYCLE_STAGE', 'create')
  @ApiOperation({ summary: 'Create a per-breed, per-stage production standard (feed rate, ADG, FCR, mortality, expected output)' })
  async create(@Body() dto: CreateBreedLifecycleStageDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.breedService.createLifecycleStage(dto, tenantId, req.user);
    return { success: true, message: 'Breed lifecycle stage created successfully.', data: result };
  }

  @Get()
  @RequirePermission('MASTER_DATA', 'BREED_LIFECYCLE_STAGE', 'view')
  @ApiOperation({ summary: 'List breed lifecycle stages matching filters' })
  async findAll(@Query() query: QueryBreedLifecycleStageDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.breedService.findAllLifecycleStages(query, tenantId);
    // `data` stays the array every caller already reads; total/limit/offset are
    // siblings the list screen pages on (same envelope as Item).
    return {
      success: true,
      message: 'Breed lifecycle stages retrieved successfully.',
      data: result.data,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    };
  }

  @Get(':id')
  @RequirePermission('MASTER_DATA', 'BREED_LIFECYCLE_STAGE', 'view')
  @ApiOperation({ summary: 'Fetch a single breed lifecycle stage' })
  @ApiParam({ name: 'id', description: 'Lifecycle stage UUID' })
  async findOne(@Param('id') id: string) {
    const result = await this.breedService.findOneLifecycleStage(id);
    return { success: true, message: 'Breed lifecycle stage retrieved.', data: result };
  }

  @Put(':id')
  @RequirePermission('MASTER_DATA', 'BREED_LIFECYCLE_STAGE', 'edit')
  @ApiOperation({ summary: 'Update a breed lifecycle stage' })
  @ApiParam({ name: 'id', description: 'Lifecycle stage UUID' })
  async update(@Param('id') id: string, @Body() dto: UpdateBreedLifecycleStageDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.breedService.updateLifecycleStage(id, dto, tenantId, req.user);
    return { success: true, message: 'Breed lifecycle stage updated successfully.', data: result };
  }

  @Delete(':id')
  @RequirePermission('MASTER_DATA', 'BREED_LIFECYCLE_STAGE', 'delete')
  @ApiOperation({ summary: 'Deactivate a breed lifecycle stage' })
  @ApiParam({ name: 'id', description: 'Lifecycle stage UUID' })
  async remove(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    return this.breedService.removeLifecycleStage(id, tenantId, req.user);
  }

  // Mirrors Breed's own restore, down to the permission: reactivating is an
  // edit, not a separate right. Without this the list had no way back from a
  // deactivated row, so its Active column could not be a switch.
  @Patch(':id/restore')
  @RequirePermission('MASTER_DATA', 'BREED_LIFECYCLE_STAGE', 'edit')
  @ApiOperation({ summary: 'Reactivate a deactivated breed lifecycle stage' })
  @ApiParam({ name: 'id', description: 'Lifecycle stage UUID' })
  async restore(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    return this.breedService.restoreLifecycleStage(id, tenantId, req.user);
  }
}
